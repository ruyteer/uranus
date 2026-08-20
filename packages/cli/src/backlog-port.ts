import type { Clock, EventBus, PlanRejection, ProjectDigest, Task } from '@uranus/core'
import type { FileBacklogStore } from '@uranus/backlog'
import { backlogProgress } from '@uranus/backlog'
import type { BacklogPort, PlanningService } from '@uranus/kernel'

/**
 * Implementação da porta de backlog que o kernel usa para se abastecer sozinho
 * (§5 e §6 do design da categoria ②).
 *
 * A forma vem de `@uranus/kernel`; quem **implementa** é a composição, porque o
 * kernel não depende de `@uranus/backlog` e nunca vai conhecer
 * `FileBacklogStore` nem o formato em disco dos itens. Mesmo padrão de
 * `deferFinding`/`findingsToTasks`.
 */
export interface BacklogPortDeps {
  readonly backlog: Pick<FileBacklogStore, 'list' | 'get' | 'update'>
  readonly planning: Pick<PlanningService, 'planItem'>
  /** `emit` grava o que aconteceu; `on` captura as recusas reais do validador. */
  readonly events: Pick<EventBus, 'emit' | 'on'>
  readonly clock: Pick<Clock, 'now'>
  /** Lido a cada planejamento: o digest pode ter sido reconstruído no meio do run. */
  readonly digest: () => Promise<ProjectDigest | undefined>
  readonly autoPlan: boolean
  readonly maxPlanningFailures: number
}

/**
 * Fábrica com dependências estreitas, em vez de um objeto solto dentro de
 * `compose()`: assim o ciclo "planeja → recusa → conta a falha → fecha o item"
 * é exercitável sem subir estado, provider nem sandbox.
 */
export function createBacklogPort(deps: BacklogPortDeps): BacklogPort {
  return {
    async nextPlannable(signal: AbortSignal) {
      // `autoPlan: false` é "não planeje por mim": a porta continua ligada
      // porque fechar item concluído (`taskFinished`) não tem nada a ver com
      // planejar — só o planejamento automático some.
      if (!deps.autoPlan || signal.aborted) return undefined
      const abertos = await deps.backlog.list('open')
      // Sem reordenar: `list()` já devolve por prioridade desc, criação asc.
      const alvo = abertos.find(
        (item) => (item.planningFailures ?? 0) < deps.maxPlanningFailures,
      )
      return alvo === undefined ? undefined : { id: alvo.id, title: alvo.title }
    },

    async plan(itemId: string, signal: AbortSignal) {
      const item = await deps.backlog.get(itemId)
      if (item === undefined) return undefined

      // As recusas de verdade (`code` + `detail`) só existem dentro do
      // `PlanningService`; o erro que ele devolve carrega apenas as mensagens.
      // Assinar `PlanRejected` durante a chamada é o que permite emitir
      // `BacklogItemPlanningFailed` com o objeto íntegro em vez de reconstruir
      // um `code` chutado a partir do texto.
      let rejections: readonly PlanRejection[] = []
      const parar = deps.events.on('PlanRejected', (event) => {
        if (event.payload.sourceItemId === itemId) rejections = event.payload.rejections
      })
      // Registrar a falha é responsabilidade desta porta, e ela precisa
      // acontecer nos DOIS caminhos de fracasso: o `Result` de erro e a
      // exceção. Só o primeiro estava coberto, e o segundo é justamente o
      // caso comum (provider fora do ar, rate limit) — o item ficava sem
      // `planningFailures` nem `lastRejections`, então `uranus backlog show`
      // não explicava nada ao humano e o teto de recusas nunca engatava,
      // fazendo todo `uranus start` retentar o mesmo item para sempre.
      const registrarFalha = async (motivo: string): Promise<void> => {
        const failures = (item.planningFailures ?? 0) + 1
        await deps.backlog.update({
          ...item,
          planningFailures: failures,
          // `lastRejections` é `string[]` no store — o YAML é para o humano ler.
          // Sem recusa nenhuma capturada a falha veio de outro lugar (provider
          // fora do ar, orçamento), e o texto do erro é o único sinal que existe.
          lastRejections:
            rejections.length > 0 ? rejections.map((rejection) => rejection.message) : [motivo],
        })
        await deps.events.emit('BacklogItemPlanningFailed', { itemId, failures, rejections })
      }

      let resultado
      try {
        resultado = await deps.planning.planItem(item, await deps.digest(), signal)
      } catch (error: unknown) {
        await registrarFalha(error instanceof Error ? error.message : String(error))
        // Repropaga de propósito: o kernel trata exceção como "encerre o run",
        // e isso é o certo para uma falha de infraestrutura — insistir item a
        // item com o provider fora do ar só queima orçamento. A diferença é
        // que agora o item carrega o motivo quando o humano voltar.
        throw error
      } finally {
        parar()
      }

      if (!resultado.ok) {
        await registrarFalha(resultado.error.message)
        return undefined
      }

      // Recusas antigas descrevem um plano que não existe mais: mantê-las faria
      // `uranus backlog show` acusar problemas já resolvidos.
      const { lastRejections: _recusasAntigas, ...semRecusas } = item
      await deps.backlog.update({
        ...semRecusas,
        state: 'planned',
        planId: resultado.value.planId,
        startedAt: deps.clock.now(),
      })
      await deps.events.emit('BacklogItemPlanned', {
        itemId,
        planId: resultado.value.planId,
        tasks: resultado.value.created.length,
      })
      return resultado.value.created.length
    },

    async taskFinished(itemId: string, siblings: readonly Task[]) {
      const item = await deps.backlog.get(itemId)
      // `done` de novo emitiria `BacklogItemCompleted` duas vezes para o mesmo
      // item — o log é a fonte da verdade, e um fato repetido nele é mentira.
      if (item === undefined || item.state === 'done' || item.state === 'dropped') return

      const progress = backlogProgress(siblings)
      if (!progress.complete) return

      await deps.backlog.update({ ...item, state: 'done' })
      await deps.events.emit('BacklogItemCompleted', {
        itemId,
        tasks: progress.total,
        // Item planejado antes de `startedAt` existir não tem duração; zero é
        // honesto ("não sei"), e um relógio negativo seria pior que nada.
        durationMs:
          item.startedAt === undefined ? 0 : Math.max(0, deps.clock.now() - item.startedAt),
      })
    },
  }
}
