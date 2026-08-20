import type {
  AcceptanceContract,
  Check,
  Glob,
  PlanRejection,
  Result,
  TaskDraft,
  TaskKind,
} from '@uranus/core'
import {
  TASK_KINDS,
  err,
  globsIntersect,
  isEnforceable,
  matchesAny,
  ok,
  toPosix,
} from '@uranus/core'
import type {
  PlannerCheck,
  PlannerCrossProjectItem,
  PlannerOutput,
  PlannerTask,
} from './plan-schema.js'

export interface PlanValidationOptions {
  /** Globs onde o plano PODE escrever. Vem da config do projeto. */
  readonly allowedPaths: readonly Glob[]
  /** Globs proibidos mesmo dentro do permitido (CI, secrets, infra). */
  readonly forbiddenPaths: readonly Glob[]
  /** Runners de teste que o projeto realmente possui (do ProjectDigest). */
  readonly knownTestRunners: readonly string[]
  /** Comandos que o executor pode rodar. Vazio = qualquer comando é suspeito. */
  readonly allowedCommands: readonly string[]
  readonly maxTasks: number
  /** Em modo restrito (R4) só tasks `test` são aceitas. */
  readonly restrictedMode: boolean
  /**
   * Aliases de projetos vizinhos onde este projeto pode CRIAR itens de backlog
   * (`linkedProjects[].backlogWrite`).
   *
   * Ausente ou vazio ⇒ nenhum vizinho gravável, e qualquer `crossProject` no
   * plano é rejeitado. É o default seguro: um projeto que nunca ouviu falar
   * desta opção não passa a escrever no repo de ninguém.
   */
  readonly writableProjects?: readonly string[]
}

export interface ValidatedPlan {
  readonly summary: string
  readonly rationale: string
  readonly risks: readonly string[]
  readonly assumptions: readonly string[]
  /** Ordem topológica — dependências antes dos dependentes. */
  readonly drafts: readonly TaskDraft[]
  /** `ref` do plano → índice em `drafts`. Usado para religar `deps` após criar ids. */
  readonly refOrder: readonly string[]
  readonly dependencies: Readonly<Record<string, readonly string[]>>
  /**
   * Itens a criar no backlog de vizinhos. Deliberadamente FORA de `drafts`:
   * nenhum deles vira task na fila deste projeto.
   */
  readonly crossProject: readonly PlannerCrossProjectItem[]
}

/**
 * Validador determinístico de planos — a fronteira do ADR-002.
 *
 * O `Planner` produz dados; ESTE código decide se viram trabalho. Nada aqui
 * consulta modelo, e um plano rejeitado **não toca o repositório**: a rejeição
 * acontece antes de qualquer worktree existir.
 *
 * As checagens estão ordenadas da mais barata para a mais cara, mas todas rodam
 * — o retorno lista TODOS os problemas, porque um Planner que recebe um erro
 * por vez gasta uma sessão inteira por correção.
 */
export function validatePlan(
  output: PlannerOutput,
  options: PlanValidationOptions,
): Result<ValidatedPlan, readonly PlanRejection[]> {
  const rejections: PlanRejection[] = []

  if (output.tasks.length === 0) {
    return err([{ code: 'empty', message: 'O plano não contém nenhuma task.' }])
  }
  if (output.tasks.length > options.maxTasks) {
    rejections.push({
      code: 'too-large',
      message: `O plano tem ${String(output.tasks.length)} tasks (máximo ${String(options.maxTasks)}). Decomponha em itens de backlog menores.`,
    })
  }

  // ── Refs únicos ───────────────────────────────────────────────────────────
  const seenRefs = new Set<string>()
  output.tasks.forEach((task, index) => {
    if (seenRefs.has(task.ref)) {
      rejections.push({
        code: 'unknown-dependency',
        message: `ref duplicado: "${task.ref}".`,
        taskIndex: index,
      })
    }
    seenRefs.add(task.ref)
  })

  // ── Por task ──────────────────────────────────────────────────────────────
  output.tasks.forEach((task, index) => {
    validateKind(task, index, options, rejections)
    validateTouches(task, index, options, rejections)
    validateAcceptance(task, index, options, rejections)
    validateDependencies(task, index, seenRefs, rejections)
  })

  // ── Grafo ─────────────────────────────────────────────────────────────────
  const sorted = topologicalSort(output.tasks)
  if (sorted === undefined) {
    rejections.push({
      code: 'cyclic-dependency',
      message: 'As dependências entre as tasks formam um ciclo.',
    })
  }

  // ── Conflito de escopo entre tasks independentes ──────────────────────────
  // Duas tasks sem relação de dependência que tocam os mesmos arquivos nunca
  // poderiam rodar em paralelo (R6) e provavelmente deveriam ser uma só.
  detectScopeCollisions(output.tasks, rejections)

  // ── Trabalho declarado em projetos vizinhos ───────────────────────────────
  const crossProject = output.crossProject ?? []
  validateCrossProject(crossProject, options, rejections)

  if (rejections.length > 0) return err(rejections)

  const order = sorted!
  const drafts = order.map((task) => toDraft(task, options))
  const dependencies: Record<string, readonly string[]> = {}
  for (const task of order) dependencies[task.ref] = task.dependsOn ?? []

  return ok({
    summary: output.summary,
    rationale: output.rationale,
    risks: output.risks ?? [],
    assumptions: output.assumptions ?? [],
    drafts,
    refOrder: order.map((task) => task.ref),
    dependencies,
    crossProject,
  })
}

// ── Checagens individuais ───────────────────────────────────────────────────

function validateKind(
  task: PlannerTask,
  index: number,
  options: PlanValidationOptions,
  rejections: PlanRejection[],
): void {
  if (!(TASK_KINDS as readonly string[]).includes(task.kind)) {
    rejections.push({
      code: 'invalid-task-kind',
      message: `Tipo de task desconhecido: "${task.kind}".`,
      taskIndex: index,
    })
    return
  }
  if (options.restrictedMode && task.kind !== 'test') {
    rejections.push({
      code: 'invalid-task-kind',
      message: `O projeto está em modo restrito (sem sinal de verificação): apenas tasks "test" são aceitas, recebido "${task.kind}".`,
      taskIndex: index,
    })
  }
}

function validateTouches(
  task: PlannerTask,
  index: number,
  options: PlanValidationOptions,
  rejections: PlanRejection[],
): void {
  for (const glob of task.touches) {
    const normalized = toPosix(glob)

    // Escape de diretório: `../` sai do repositório inteiro (INV-5).
    if (normalized.includes('..') || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
      rejections.push({
        code: 'paths-out-of-scope',
        message: `Escopo inválido "${glob}": caminhos devem ser relativos à raiz do repositório.`,
        taskIndex: index,
      })
      continue
    }
    if (options.forbiddenPaths.length > 0 && matchesAny(normalized, options.forbiddenPaths)) {
      rejections.push({
        code: 'paths-out-of-scope',
        message: `Escopo "${glob}" toca caminho proibido pela configuração do projeto.`,
        taskIndex: index,
        detail: { forbidden: options.forbiddenPaths },
      })
      continue
    }
    // Um `**` solto daria à task o repositório inteiro — o lease de arquivo
    // deixaria de significar qualquer coisa e o DiffCheck não barraria nada.
    if (normalized === '**' || normalized === '*' || normalized === '.') {
      rejections.push({
        code: 'paths-out-of-scope',
        message: `Escopo "${glob}" é amplo demais: declare os diretórios que a task realmente altera.`,
        taskIndex: index,
      })
      continue
    }
    if (options.allowedPaths.length > 0 && !globsIntersect([normalized], options.allowedPaths)) {
      rejections.push({
        code: 'paths-out-of-scope',
        message: `Escopo "${glob}" está fora dos caminhos permitidos para este projeto.`,
        taskIndex: index,
        detail: { allowed: options.allowedPaths },
      })
    }
  }
}

function validateAcceptance(
  task: PlannerTask,
  index: number,
  options: PlanValidationOptions,
  rejections: PlanRejection[],
): void {
  const checks = task.acceptance.checks
  if (checks.length === 0) {
    rejections.push({
      code: 'missing-acceptance',
      message: `Task "${task.ref}" não tem contrato de aceite (INV-2).`,
      taskIndex: index,
    })
    return
  }

  const ids = new Set<string>()
  for (const check of checks) {
    if (ids.has(check.id)) {
      rejections.push({
        code: 'unenforceable-acceptance',
        message: `Task "${task.ref}" tem checks com id duplicado: "${check.id}".`,
        taskIndex: index,
      })
    }
    ids.add(check.id)

    if (check.kind === 'tests' && !options.knownTestRunners.includes(check.runner)) {
      rejections.push({
        code: 'unenforceable-acceptance',
        message: `Task "${task.ref}" usa o runner de testes "${check.runner}", que este projeto não possui (disponíveis: ${options.knownTestRunners.join(', ') || 'nenhum'}).`,
        taskIndex: index,
      })
    }
    if (check.kind === 'command') {
      const problem = commandProblem(check.run, options.allowedCommands)
      if (problem !== undefined) {
        rejections.push({
          code: 'unenforceable-acceptance',
          message: `Task "${task.ref}", check "${check.id}": ${problem}`,
          taskIndex: index,
        })
      }
    }
    if (check.kind === 'artifact' && check.matches !== undefined) {
      try {
        new RegExp(check.matches)
      } catch {
        rejections.push({
          code: 'unenforceable-acceptance',
          message: `Task "${task.ref}", check "${check.id}": regex inválida "${check.matches}".`,
          taskIndex: index,
        })
      }
    }
  }

  // Um contrato só de `diff` aprova qualquer alteração não-vazia dentro do
  // escopo — não prova comportamento. Exigimos ao menos um check substantivo.
  const substantive = checks.some(
    (check) => check.kind === 'command' || check.kind === 'tests' || check.kind === 'artifact',
  )
  if (!substantive) {
    rejections.push({
      code: 'unenforceable-acceptance',
      message: `Task "${task.ref}": o contrato só verifica o formato do diff. Inclua um comando, uma suíte de testes ou um artefato que prove o comportamento (INV-2).`,
      taskIndex: index,
    })
  }
}

/**
 * Um comando de verificação que altera estado não é verificação — é execução
 * disfarçada, fora do sandbox de permissões do agente.
 */
const DANGEROUS_COMMAND = /(^|[\s;&|])(rm|del|rmdir|mv|curl|wget|ssh|scp|chmod|chown|sudo)\s/i
const CONTROL_OPERATORS = /(\|\||&&|;|\$\(|`|>>|>)/

function commandProblem(run: string, allowed: readonly string[]): string | undefined {
  if (DANGEROUS_COMMAND.test(` ${run}`)) {
    return `o comando "${run}" altera estado ou acessa a rede; um check deve apenas verificar.`
  }
  if (/\bgit\s+(push|commit|merge|reset|checkout|rebase)\b/i.test(run)) {
    return `o comando "${run}" manipula o repositório; integração é responsabilidade do kernel, não do contrato.`
  }
  if (CONTROL_OPERATORS.test(run)) {
    return `o comando "${run}" usa operadores de shell; use um único comando por check.`
  }
  if (allowed.length > 0 && !allowed.some((prefix) => run.startsWith(prefix))) {
    return `o comando "${run}" não está na lista de comandos permitidos do projeto (${allowed.join(', ')}).`
  }
  return undefined
}

function validateDependencies(
  task: PlannerTask,
  index: number,
  knownRefs: ReadonlySet<string>,
  rejections: PlanRejection[],
): void {
  for (const dependency of task.dependsOn ?? []) {
    if (dependency === task.ref) {
      rejections.push({
        code: 'cyclic-dependency',
        message: `Task "${task.ref}" depende de si mesma.`,
        taskIndex: index,
      })
      continue
    }
    if (!knownRefs.has(dependency)) {
      rejections.push({
        code: 'unknown-dependency',
        message: `Task "${task.ref}" depende de "${dependency}", que não existe no plano.`,
        taskIndex: index,
      })
    }
  }
}

/**
 * Trabalho declarado para vizinhos: só passa o que aponta para um alias que o
 * humano autorizou na config (`backlogWrite: true`).
 *
 * Alias desconhecido é REJEIÇÃO do plano inteiro, nunca item descartado em
 * silêncio. O alias vem de saída de modelo — aceitar o plano ignorando a parte
 * que não casou faria o Uranus reportar "planejado" tendo jogado fora
 * justamente a metade que dependia do outro projeto.
 */
function validateCrossProject(
  items: readonly PlannerCrossProjectItem[],
  options: PlanValidationOptions,
  rejections: PlanRejection[],
): void {
  if (items.length === 0) return

  const writable = options.writableProjects ?? []
  const known = new Set(writable)

  items.forEach((item, index) => {
    if (!known.has(item.project)) {
      rejections.push({
        code: 'unknown-cross-project',
        message:
          writable.length === 0
            ? `O plano cria trabalho no projeto "${item.project}", mas este projeto não tem nenhum vizinho com permissão de escrita no backlog. Resolva tudo dentro deste projeto.`
            : `O plano cria trabalho no projeto "${item.project}", que não é um vizinho gravável (disponíveis: ${writable.join(', ')}).`,
        detail: { project: item.project, writable, crossProjectIndex: index },
      })
      return
    }
    if (item.kind !== undefined && !(TASK_KINDS as readonly string[]).includes(item.kind)) {
      rejections.push({
        code: 'invalid-task-kind',
        message: `Item cross-project "${item.title}" usa o tipo desconhecido "${item.kind}".`,
        detail: { project: item.project, crossProjectIndex: index },
      })
    }
  })
}

function detectScopeCollisions(tasks: readonly PlannerTask[], rejections: PlanRejection[]): void {
  const related = transitiveDependencies(tasks)
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const a = tasks[i]!
      const b = tasks[j]!
      const connected =
        related.get(a.ref)?.has(b.ref) === true || related.get(b.ref)?.has(a.ref) === true
      if (connected) continue
      if (globsIntersect(a.touches, b.touches)) {
        rejections.push({
          code: 'paths-out-of-scope',
          message: `As tasks "${a.ref}" e "${b.ref}" tocam os mesmos arquivos sem dependência entre si. Declare a ordem com dependsOn ou funda as duas.`,
          taskIndex: j,
          detail: { a: a.touches, b: b.touches },
        })
      }
    }
  }
}

// ── Grafo ───────────────────────────────────────────────────────────────────

/** Kahn. Retorna `undefined` se houver ciclo. */
export function topologicalSort(tasks: readonly PlannerTask[]): readonly PlannerTask[] | undefined {
  const byRef = new Map(tasks.map((task) => [task.ref, task]))
  const inDegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()

  for (const task of tasks) {
    inDegree.set(task.ref, 0)
    dependents.set(task.ref, [])
  }
  for (const task of tasks) {
    for (const dependency of task.dependsOn ?? []) {
      if (!byRef.has(dependency)) continue // já reportado como unknown-dependency
      inDegree.set(task.ref, (inDegree.get(task.ref) ?? 0) + 1)
      dependents.get(dependency)!.push(task.ref)
    }
  }

  // Ordem estável: entre elegíveis, a que aparece antes no plano vence.
  const position = new Map(tasks.map((task, index) => [task.ref, index]))
  const readyRefs = tasks.filter((task) => inDegree.get(task.ref) === 0).map((task) => task.ref)
  const sorted: PlannerTask[] = []

  while (readyRefs.length > 0) {
    readyRefs.sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0))
    const ref = readyRefs.shift()!
    sorted.push(byRef.get(ref)!)
    for (const dependent of dependents.get(ref) ?? []) {
      const degree = (inDegree.get(dependent) ?? 1) - 1
      inDegree.set(dependent, degree)
      if (degree === 0) readyRefs.push(dependent)
    }
  }

  return sorted.length === tasks.length ? sorted : undefined
}

function transitiveDependencies(
  tasks: readonly PlannerTask[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const direct = new Map(tasks.map((task) => [task.ref, task.dependsOn ?? []]))
  const closure = new Map<string, Set<string>>()

  const resolve = (ref: string, seen: Set<string>): Set<string> => {
    const cached = closure.get(ref)
    if (cached !== undefined) return cached
    if (seen.has(ref)) return new Set()
    seen.add(ref)
    const result = new Set<string>()
    for (const dependency of direct.get(ref) ?? []) {
      result.add(dependency)
      for (const nested of resolve(dependency, seen)) result.add(nested)
    }
    closure.set(ref, result)
    return result
  }

  for (const task of tasks) resolve(task.ref, new Set())
  return closure
}

// ── Conversão ───────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUTS: Readonly<Record<PlannerCheck['kind'], number>> = {
  command: 300_000,
  tests: 600_000,
  artifact: 10_000,
  diff: 30_000,
}

function toDraft(task: PlannerTask, options: PlanValidationOptions): TaskDraft {
  const checks: Check[] = task.acceptance.checks.map((check) => toCheck(check))

  // O harness SEMPRE acrescenta o DiffCheck de escopo — nem que o Planner
  // esqueça. É o que faz cumprir o INV-5 independentemente do plano.
  if (!checks.some((check) => check.kind === 'diff')) {
    checks.push({
      kind: 'diff',
      id: 'escopo-e-mudanca',
      requireNonEmpty: true,
      timeoutMs: DEFAULT_TIMEOUTS.diff,
    })
  }

  const acceptance: AcceptanceContract = { checks, requireAll: true }
  if (!isEnforceable(acceptance)) {
    // Inalcançável: validateAcceptance já barrou. Guarda contra regressão.
    throw new Error(`Contrato não executável escapou da validação: ${task.ref}`)
  }

  return {
    kind: task.kind as TaskKind,
    title: task.title,
    intent: task.intent,
    touches: task.touches.map(toPosix),
    acceptance,
    ...(options.restrictedMode ? { labels: ['modo-restrito'] } : {}),
  }
}

function toCheck(check: PlannerCheck): Check {
  switch (check.kind) {
    case 'command':
      return {
        kind: 'command',
        id: check.id,
        run: check.run,
        timeoutMs: DEFAULT_TIMEOUTS.command,
        ...(check.expectExit === undefined ? {} : { expectExit: check.expectExit }),
      }
    case 'tests':
      return {
        kind: 'tests',
        id: check.id,
        runner: check.runner,
        timeoutMs: DEFAULT_TIMEOUTS.tests,
        ...(check.scope === undefined ? {} : { scope: check.scope }),
        ...(check.requireNewTests === undefined ? {} : { requireNewTests: check.requireNewTests }),
        ...(check.forbidSkipped === undefined ? {} : { forbidSkipped: check.forbidSkipped }),
      }
    case 'artifact':
      return {
        kind: 'artifact',
        id: check.id,
        path: check.path,
        mustExist: check.mustExist,
        timeoutMs: DEFAULT_TIMEOUTS.artifact,
        ...(check.matches === undefined ? {} : { matches: check.matches }),
      }
    case 'diff':
      return {
        kind: 'diff',
        id: check.id,
        timeoutMs: DEFAULT_TIMEOUTS.diff,
        ...(check.requireNonEmpty === undefined ? {} : { requireNonEmpty: check.requireNonEmpty }),
        ...(check.maxFiles === undefined ? {} : { maxFiles: check.maxFiles }),
        ...(check.maxLines === undefined ? {} : { maxLines: check.maxLines }),
      }
  }
}
