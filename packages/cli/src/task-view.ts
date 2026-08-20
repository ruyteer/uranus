import type {
  Task,
  TaskGroup,
  TaskState,
  ValidationPolicy,
  ValidationPolicyInput,
  ValidationRule,
  ValidationSeverity,
} from '@uranus/core'
import {
  VALIDATION_RULES,
  allowedTransitions,
  severityOf,
  taskGroup,
  taskGroupLabel,
  taskStateLabel,
} from '@uranus/core'

/**
 * Formatação da fila e da política de validação — funções puras.
 *
 * Separadas do `main.ts` porque é aqui que mora a decisão de o que o humano vê:
 * agrupamento, rótulo e origem de cada regra são testáveis por igualdade de
 * string, enquanto o comando em si só faz I/O em volta disto.
 */

/**
 * Ordem de exibição dos grupos. Não é a ordem do ciclo de vida de propósito: o
 * que precisa de decisão humana vem primeiro, porque numa fila longa o final da
 * saída é o que fica na tela — e "Encerrada" é justamente o que não pede nada.
 */
export const TASK_GROUP_ORDER: readonly TaskGroup[] = [
  'attention',
  'working',
  'queued',
  'finished',
]

export interface TaskGroupView {
  readonly group: TaskGroup
  readonly label: string
  readonly tasks: readonly Task[]
}

/** Agrupa preservando a ordem recebida dentro de cada grupo; grupo vazio some. */
export function groupTasks(tasks: readonly Task[]): readonly TaskGroupView[] {
  return TASK_GROUP_ORDER.map((group) => ({
    group,
    label: taskGroupLabel(group),
    tasks: tasks.filter((task) => taskGroup(task) === group),
  })).filter((view) => view.tasks.length > 0)
}

export const REPAIR_LEGEND =
  '↻N = N reparo(s) dirigido(s) de validação — não contam para as tentativas.'

export function formatTaskLine(task: Task): string {
  const bloqueio = task.blockReason === undefined ? '' : ` [${task.blockReason.message}]`
  // Task derivada de revisão fica marcada na listagem: "de onde veio isto?" era
  // a pergunta mais cara de responder no fluxo antigo.
  const origem =
    task.lineage === undefined
      ? ''
      : ` (↳ g${String(task.lineage.generation)} de ${task.lineage.parentTaskId})`
  // De que item de backlog a task nasceu. Com o planejamento automático do
  // `uranus start`, a fila passa a encher sozinha: sem esta marca, "por que
  // isto está sendo feito?" exigiria abrir o plano task por task.
  const item = task.backlogItemId === undefined ? '' : ` (item ${task.backlogItemId})`
  const reparos = task.repairAttempts > 0 ? ` ↻${String(task.repairAttempts)}` : ''
  const contadores = `${String(task.attempts)}/${String(task.maxAttempts)}${reparos}`
  return (
    `${task.id}  ${taskStateLabel(task.state).padEnd(12)} ${task.kind.padEnd(9)} ` +
    `${contadores.padEnd(9)} ${task.title}${item}${origem}${bloqueio}`
  )
}

/**
 * Mensagem de transição recusada, com as saídas reais a partir do estado atual.
 *
 * Sem a lista de destinos permitidos, o operador descobre o caminho por
 * tentativa e erro — e a máquina de estados não está documentada no `--help`.
 */
export function explainIllegalTransition(from: TaskState, to: string): string {
  const permitidos = allowedTransitions(from)
  const destinos =
    permitidos.length === 0
      ? 'nenhum — este é um estado terminal'
      : permitidos.map((state) => `${state} (${taskStateLabel(state)})`).join(', ')
  return (
    `Transição ilegal: ${from} → ${to}.\n` +
    `A partir de "${taskStateLabel(from)}" só dá para ir para: ${destinos}`
  )
}

// ── validações ──────────────────────────────────────────────────────────────

/** De onde saiu a severidade efetiva de uma regra. */
export type ValidationRuleOrigin = 'default' | 'config' | 'global-off'

export interface ValidationRuleView {
  readonly rule: ValidationRule
  readonly severity: ValidationSeverity
  readonly origin: ValidationRuleOrigin
}

export const VALIDATION_ORIGIN_LABEL: Readonly<Record<ValidationRuleOrigin, string>> = {
  default: 'default do Uranus',
  config: 'validations.rules',
  'global-off': 'validations.enabled: false',
}

/**
 * Exportado porque o `uranus config` guiado oferece exatamente estas três
 * opções: as duas telas precisam chamar a mesma coisa pelo mesmo nome, ou o
 * humano escolhe "avisa, não reprova" num lugar e lê outro rótulo no outro.
 */
export const VALIDATION_SEVERITY_LABEL: Readonly<Record<ValidationSeverity, string>> = {
  off: 'não verifica',
  advisory: 'avisa, não reprova',
  blocking: 'reprova a verificação',
}

/**
 * A severidade efetiva de cada regra e a sua procedência.
 *
 * `input` é a seção `validations` da config **como veio do arquivo** — é o único
 * jeito de distinguir "blocking porque o projeto pediu" de "blocking porque é o
 * default": depois de `resolveValidationPolicy` as duas são a mesma string.
 */
export function describeValidationRules(
  policy: ValidationPolicy,
  input?: ValidationPolicyInput,
): readonly ValidationRuleView[] {
  return VALIDATION_RULES.map((rule) => ({
    rule,
    severity: severityOf(policy, rule),
    origin: !policy.enabled
      ? ('global-off' as const)
      : input?.rules?.[rule] === undefined
        ? ('default' as const)
        : ('config' as const),
  }))
}

/** Relatório completo do `uranus validations`, linha a linha. */
export function renderValidations(
  policy: ValidationPolicy,
  input?: ValidationPolicyInput,
): readonly string[] {
  const linhas: string[] = []
  linhas.push(
    policy.enabled
      ? 'Validações: ligadas'
      : 'Validações: DESLIGADAS (validations.enabled: false) — nenhuma regra roda',
  )
  linhas.push('')
  linhas.push(`  ${'regra'.padEnd(16)} ${'severidade'.padEnd(10)} origem`)
  for (const view of describeValidationRules(policy, input)) {
    linhas.push(
      `  ${view.rule.padEnd(16)} ${view.severity.padEnd(10)} ${VALIDATION_ORIGIN_LABEL[view.origin]}`,
    )
  }
  linhas.push('')
  for (const severity of ['off', 'advisory', 'blocking'] as const) {
    linhas.push(`  ${severity.padEnd(10)} ${VALIDATION_SEVERITY_LABEL[severity]}`)
  }
  linhas.push('')
  linhas.push(
    `countTowardAttempts : ${String(policy.countTowardAttempts)}` +
      (policy.countTowardAttempts
        ? ' — falha de validação gasta tentativa de execução'
        : ' — falha de validação não gasta tentativa; vira reparo dirigido'),
  )
  linhas.push(
    `maxRepairAttempts   : ${String(policy.maxRepairAttempts)}` +
      ' — reparos por task antes de a falha contar como tentativa de verdade',
  )
  linhas.push('')
  linhas.push('Ajuste em .uranus/config.yaml, seção `validations`.')
  return linhas
}
