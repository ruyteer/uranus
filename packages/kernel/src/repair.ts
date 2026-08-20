import type {
  CheckKind,
  CheckResult,
  DiagnosisCategory,
  Task,
  ValidationPolicy,
  ValidationRule,
  Verification,
} from '@uranus/core'
import { failedChecks, isRuleEnabled } from '@uranus/core'

/**
 * Reparo dirigido: classificar a falha e descrever o que exatamente reprovou.
 *
 * O problema que isto resolve é o observado em produção: o agente falhava a
 * verificação por violação de política ("diff fora do escopo declarado"),
 * recebia de volta só a CATEGORIA da falha, tentava adivinhar, falhava de novo
 * do mesmo jeito, e em três voltas a task era bloqueada e replanejada — gerando
 * tasks novas que herdavam o mesmo problema. Duas coisas faltavam, e as duas
 * moram aqui: separar "violação de política" de "defeito no código", e entregar
 * ao agente os arquivos e as mensagens concretas em vez do rótulo.
 *
 * Puro e sem I/O de propósito: é a mesma exigência de `state-machine.ts` — a
 * decisão precisa ser testável exaustivamente sem subir um kernel.
 */

/**
 * Categorias em que a falha é (potencialmente) violação de política, corrigível
 * na própria task.
 *
 * `compile-error`, `type-error`, `test-failure`, `provider-error`, `budget`,
 * `conflict`, `permission-denied` e `timeout` ficam de fora: são defeito ou
 * infraestrutura, e para eles a política antiga (tentativa real, escalada,
 * replanejamento) continua sendo a resposta certa.
 */
const REPAIRABLE_CATEGORIES: ReadonlySet<DiagnosisCategory> = new Set<DiagnosisCategory>([
  'out-of-scope',
  'lint-failure',
  'coverage-shortfall',
  'no-changes',
  'schema-mismatch',
])

export function isRepairableCategory(category: DiagnosisCategory): boolean {
  return REPAIRABLE_CATEGORIES.has(category)
}

/** Um check reprovado, traduzido para o que o agente precisa saber para corrigir. */
export interface RepairItem {
  readonly checkId: string
  readonly kind: CheckKind
  /** Regras de validação violadas por este check. Nunca vazio. */
  readonly rules: readonly ValidationRule[]
  /** As mensagens exatas produzidas pela verificação — não um resumo delas. */
  readonly problems: readonly string[]
  /** Caminhos citados nas mensagens. Vazio quando o problema não é sobre arquivo. */
  readonly paths: readonly string[]
}

/**
 * O contexto de uma volta de reparo. Viaja para o prompt da próxima tentativa.
 */
export interface RepairBrief {
  readonly category: DiagnosisCategory
  readonly items: readonly RepairItem[]
  /** União das regras violadas — é o que vai no evento `TaskRepairScheduled`. */
  readonly rules: readonly ValidationRule[]
  /** União dos caminhos citados, sem repetição. */
  readonly paths: readonly string[]
  /** `task.touches` no momento da falha: o que o agente PODE tocar. */
  readonly allowedScope: readonly string[]
}

// ── Marcadores das mensagens produzidas pela verificação ────────────────────
//
// Acoplamento assumido e localizado: as strings abaixo são as que
// `evaluateDiff`/`testsCheckImpl` emitem. A alternativa — cada check devolver a
// `ValidationRule` que violou — atravessa o contrato de `CheckResult`, que é
// implementado por plugins de terceiros. Ler a mensagem aqui degrada com
// elegância (marcador desconhecido ⇒ nenhuma regra ⇒ não é reparo, segue o
// caminho antigo), enquanto um campo novo obrigatório quebraria plugin alheio.

interface DiffMarker {
  readonly rule: ValidationRule
  readonly marker: string
  /** A mensagem lista caminhos depois de `": "`? */
  readonly carriesPaths: boolean
}

const DIFF_MARKERS: readonly DiffMarker[] = [
  { rule: 'emptyDiff', marker: 'diff vazio', carriesPaths: false },
  { rule: 'forbiddenPaths', marker: 'caminhos proibidos', carriesPaths: true },
  { rule: 'scope', marker: 'fora do escopo declarado', carriesPaths: true },
  { rule: 'diffSize', marker: 'arquivos (máximo', carriesPaths: false },
  { rule: 'diffSize', marker: 'linhas (máximo', carriesPaths: false },
]

function stringsAt(detail: Readonly<Record<string, unknown>> | undefined, key: string): string[] {
  const value = detail?.[key]
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  return []
}

/** Caminhos listados depois do `": "` de uma mensagem que os enumera. */
function pathsIn(message: string): readonly string[] {
  const separator = message.indexOf(': ')
  if (separator < 0) return []
  return message
    .slice(separator + 2)
    .split(',')
    .map((path) => path.trim())
    .filter((path) => path.length > 0)
}

/**
 * O que este check reprovado viola, em termos de `ValidationRule`.
 *
 * Vazio significa "não é violação de política" — e é a resposta conservadora
 * para tudo que não reconhecemos, porque tratar um defeito como reparo daria ao
 * agente três voltas extras com a instrução errada ("corrija só o apontado")
 * antes de o harness perceber que o problema era outro.
 */
export function rulesForCheck(
  result: CheckResult,
  category: DiagnosisCategory,
): readonly ValidationRule[] {
  const detail = result.detail

  // O verificador pula checks caros depois que um bloqueante barato reprovou.
  // O `skipped` não reprovou por mérito próprio: quem manda é o check que de
  // fato falhou, e contar o pulado como defeito enterraria o caminho de reparo.
  if (typeof detail?.['skipped'] === 'string') return []
  if (detail?.['timedOut'] === true) return []

  switch (result.kind) {
    case 'diff': {
      const rules = new Set<ValidationRule>()
      for (const problem of stringsAt(detail, 'problems')) {
        for (const { rule, marker } of DIFF_MARKERS) {
          if (problem.includes(marker)) rules.add(rule)
        }
      }
      return [...rules]
    }
    case 'tests': {
      // `reason` só carrega estes dois quando a suíte PASSOU e o que reprovou
      // foi a política. Suíte vermelha não tem `reason` e cai no `[]` abaixo —
      // teste quebrado é defeito, não violação de política.
      const reason = stringsAt(detail, 'reason').join(' ')
      const rules: ValidationRule[] = []
      if (reason.includes('requireNewTests')) rules.push('requireNewTests')
      if (reason.includes('forbidSkipped')) rules.push('forbidSkipped')
      return rules
    }
    case 'schema':
      return ['schema']
    case 'command':
      // Um comando é lint, typecheck, build ou qualquer script do projeto — o
      // check em si não diz qual. Só a categoria do diagnóstico distingue, e só
      // `lint-failure` é política; `type-error`/`compile-error` são defeito.
      return category === 'lint-failure' ? ['lint'] : []
    case 'artifact':
    case 'coverage':
    case 'plugin':
      return []
  }
}

/** As mensagens que o agente precisa ler, na forma exata em que foram geradas. */
function problemsOf(result: CheckResult): readonly string[] {
  const detail = result.detail
  const problems = [
    ...stringsAt(detail, 'problems'),
    ...stringsAt(detail, 'reason'),
    ...stringsAt(detail, 'errors'),
  ]
  if (problems.length > 0) return problems

  // Check de comando não tem `detail`: a evidência é a saída do processo.
  const output = `${result.stderr ?? ''}\n${result.stdout ?? ''}`.trim()
  return output.length > 0 ? [output.slice(0, 4_000)] : []
}

/**
 * Monta o brief quando — e só quando — a falha é inteiramente de validação.
 *
 * Devolve `undefined` para qualquer outra coisa: categoria fora da lista, algum
 * check reprovado que não mapeia para regra, ou política desligada. "Algum" é
 * literal e proposital: uma verificação que reprovou por escopo E por teste
 * quebrado tem um defeito dentro, e o caminho de reparo não é para defeito.
 */
export function buildRepairBrief(
  verification: Verification,
  task: Task,
  policy: ValidationPolicy,
): RepairBrief | undefined {
  const category = verification.diagnosis?.category
  if (category === undefined || !isRepairableCategory(category)) return undefined

  const failed = failedChecks(verification)
  if (failed.length === 0) return undefined

  const items: RepairItem[] = []
  for (const result of failed) {
    const rules = rulesForCheck(result, category)
    if (rules.length === 0) return undefined
    // Regra em `off` não deveria ter reprovado nada (o check nem a avalia); se
    // reprovou mesmo assim, é sinal de que a policy não chegou ao verificador —
    // tratar como reparo esconderia a inconsistência sob três voltas mudas.
    if (!rules.every((rule) => isRuleEnabled(policy, rule))) return undefined

    const problems = problemsOf(result)
    items.push({
      checkId: result.checkId,
      kind: result.kind,
      rules,
      problems,
      paths: [...new Set(problems.flatMap((problem) => pathsFor(problem, rules)))],
    })
  }

  return {
    category,
    items,
    rules: [...new Set(items.flatMap((item) => item.rules))],
    paths: [...new Set(items.flatMap((item) => item.paths))],
    allowedScope: [...task.touches],
  }
}

/** Só extrai caminhos das mensagens que sabidamente os enumeram. */
function pathsFor(problem: string, rules: readonly ValidationRule[]): readonly string[] {
  for (const { rule, marker, carriesPaths } of DIFF_MARKERS) {
    if (carriesPaths && rules.includes(rule) && problem.includes(marker)) return pathsIn(problem)
  }
  return []
}

/** As linhas de `{{items}}` do template de reparo dirigido. */
export function formatRepairItems(brief: RepairBrief): string {
  return brief.items
    .map((item) => {
      const head = `- [${item.rules.join(', ')}] check \`${item.checkId}\` (${item.kind})`
      const problems = item.problems.map((problem) => `  · ${problem}`)
      const paths =
        item.paths.length === 0
          ? []
          : [`  · arquivos envolvidos: ${item.paths.map((path) => `\`${path}\``).join(', ')}`]
      return [head, ...problems, ...paths].join('\n')
    })
    .join('\n')
}
