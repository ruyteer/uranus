import { styleText } from 'node:util'
import type { EventPayloads, Task, TaskId, UranusEvent } from '@uranus/core'
import { formatMoney } from '@uranus/core'

/**
 * Stream de eventos legível pro terminal — o que `uranus start` mostra por
 * padrão. Cobre só os ~15 eventos de sinal alto do catálogo (task começou/
 * terminou/bloqueou, checks, PR, aprovação, orçamento); o resto (ticks,
 * workspace, checkpoint, sessão de agente por turno...) é ruído interno de
 * cada tick e fica de fora — quem precisa dele usa `--verbose`.
 */

const useColor = process.stdout.isTTY && process.env['NO_COLOR'] === undefined

function paint(format: Parameters<typeof styleText>[0], text: string): string {
  if (!useColor) return text
  try {
    return styleText(format, text)
  } catch {
    return text
  }
}

const green = (s: string): string => paint('green', s)
const red = (s: string): string => paint('red', s)
const yellow = (s: string): string => paint('yellow', s)
const cyan = (s: string): string => paint('cyan', s)
const magenta = (s: string): string => paint('magenta', s)
const dim = (s: string): string => paint('dim', s)
const bold = (s: string): string => paint('bold', s)

const ICON = {
  gear: dim('⚙'),
  play: cyan('▶'),
  check: green('✓'),
  cross: red('✗'),
  warn: yellow('⚠'),
  pause: magenta('⏸'),
  retry: dim('↻'),
  tool: dim('↳'),
} as const

function line(icon: string, text: string): void {
  // eslint-disable-next-line no-console
  console.log(`${icon} ${text}`)
}

export interface PrettyPrinterDeps {
  readonly tasks: { find(id: TaskId): Promise<Task | undefined> }
}

/**
 * Cria o handler pra `events.onAny`. Mantém um cache local id → título (as
 * mensagens ficam com o título da task, não o id bruto); populado de graça
 * pelo `TaskCreated` de cada task nova, com fallback a uma consulta ao
 * repositório para tasks que já existiam antes deste run começar.
 */
export function createPrettyPrinter(deps: PrettyPrinterDeps): (event: UranusEvent) => Promise<void> {
  const titles = new Map<string, string>()

  async function titleOf(taskId: TaskId): Promise<string> {
    const cached = titles.get(taskId)
    if (cached !== undefined) return cached
    const task = await deps.tasks.find(taskId)
    const title = task?.title ?? taskId.slice(0, 12)
    titles.set(taskId, title)
    return title
  }

  return async function print(event: UranusEvent): Promise<void> {
    switch (event.name) {
      case 'TaskCreated': {
        const payload = event.payload as EventPayloads['TaskCreated']
        titles.set(payload.taskId, payload.title)
        return
      }
      case 'KernelStarted': {
        line(ICON.gear, dim('Analisando projeto e retomando a fila...'))
        return
      }
      case 'TaskStarted': {
        const payload = event.payload as EventPayloads['TaskStarted']
        line(ICON.play, `Executando: ${bold(await titleOf(payload.taskId))}`)
        return
      }
      case 'ToolCalled': {
        const payload = event.payload as EventPayloads['ToolCalled']
        const detail = payload.detail === undefined ? '' : dim(`(${payload.detail})`)
        line(ICON.tool, `${dim(payload.tool)} ${detail}`.trim())
        return
      }
      case 'VerificationCompleted': {
        const payload = event.payload as EventPayloads['VerificationCompleted']
        const { results, passed } = payload.verification
        const okCount = results.filter((r) => r.passed).length
        const total = results.length
        if (passed) {
          line(ICON.check, green(`${String(okCount)}/${String(total)} checks passaram`))
        } else {
          const failed = results
            .filter((r) => !r.passed)
            .map((r) => r.checkId)
            .join(', ')
          line(ICON.cross, red(`${String(okCount)}/${String(total)} checks — falhou: ${failed}`))
        }
        return
      }
      case 'TaskCompleted': {
        const payload = event.payload as EventPayloads['TaskCompleted']
        line(ICON.check, green(`Task concluída · ${formatMoney(payload.totalCost)}`))
        return
      }
      case 'TaskFailed': {
        const payload = event.payload as EventPayloads['TaskFailed']
        line(ICON.cross, red(`Falhou: ${payload.diagnosis.summary.slice(0, 140)}`))
        return
      }
      case 'TaskBlocked': {
        const payload = event.payload as EventPayloads['TaskBlocked']
        line(
          ICON.warn,
          yellow(`Bloqueada: ${await titleOf(payload.taskId)} — ${payload.message}`),
        )
        return
      }
      case 'TaskReplanned': {
        const payload = event.payload as EventPayloads['TaskReplanned']
        line(ICON.retry, dim(`Replanejando: ${await titleOf(payload.taskId)}`))
        return
      }
      case 'ReviewCompleted': {
        const payload = event.payload as EventPayloads['ReviewCompleted']
        if (payload.blocking > 0) {
          line(
            ICON.warn,
            yellow(
              `Gate de qualidade bloqueou: ${String(payload.blocking)} achado(s) crítico(s)`,
            ),
          )
        }
        return
      }
      case 'PRCreated': {
        const payload = event.payload as EventPayloads['PRCreated']
        line(ICON.check, cyan(`PR aberta: ${payload.pr.url}`))
        return
      }
      case 'ApprovalRequested': {
        const payload = event.payload as EventPayloads['ApprovalRequested']
        line(ICON.pause, magenta(`Aprovação necessária: ${payload.title}`))
        return
      }
      case 'BudgetExhausted': {
        const payload = event.payload as EventPayloads['BudgetExhausted']
        line(ICON.warn, red(`Orçamento esgotado (${payload.window}/${payload.dimension})`))
        return
      }
      case 'KernelPaused': {
        const payload = event.payload as EventPayloads['KernelPaused']
        line(ICON.pause, magenta(`Kernel pausado: ${payload.reason}`))
        return
      }
      case 'HumanInterventionRequested': {
        const payload = event.payload as EventPayloads['HumanInterventionRequested']
        line(ICON.pause, magenta(`Precisa de decisão humana: ${payload.reason}`))
        return
      }
      case 'RateLimited': {
        const payload = event.payload as EventPayloads['RateLimited']
        line(ICON.warn, yellow(`Provider "${payload.provider}" em rate limit — aguardando`))
        return
      }
      case 'ProviderDegraded': {
        const payload = event.payload as EventPayloads['ProviderDegraded']
        line(ICON.warn, yellow(`Provider "${payload.provider}" degradado: ${payload.reason}`))
        return
      }
      default:
        // Ruído interno de tick (TickStarted/TickCompleted, WorkspaceCreated,
        // ContextPackBuilt, AgentRunStarted/Finished, CheckpointCreated,
        // TokensConsumed por chamada, etc.) — visível só com --verbose.
        return
    }
  }
}
