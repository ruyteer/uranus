/**
 * @uranus/core — tipos, contratos e domínio.
 *
 * Raiz do grafo de dependências: não importa nenhum outro pacote e não faz I/O
 * (a regra é verificada por lint em `eslint.config.js`). Tudo o que atravessa
 * uma fronteira entre módulos do Uranus é definido aqui.
 */

// ── Primitivos ──────────────────────────────────────────────────────────────
export * from './result.js'
export * from './errors.js'
export * from './ids.js'
export * from './clock.js'
export * from './logger.js'

// ── Utilitários ─────────────────────────────────────────────────────────────
export * from './util/assert.js'
export * from './util/checksum.js'
export * from './util/glob.js'
export * from './util/json.js'
export * from './util/path.js'
export * from './util/redact.js'
export * from './util/semaphore.js'
export * from './util/tokens.js'

// ── Domínio ─────────────────────────────────────────────────────────────────
export * from './domain/usage.js'
export * from './domain/acceptance.js'
export * from './domain/verification.js'
export * from './domain/task.js'
export * from './domain/validation.js'
export * from './domain/prune.js'
export * from './domain/context-budget.js'
export * from './domain/state-machine.js'
export * from './domain/plan.js'
export * from './domain/attempt.js'
export * from './domain/vcs.js'
export * from './domain/review.js'
export * from './domain/permission.js'
export * from './domain/budget.js'
export * from './domain/memory.js'
export * from './domain/context.js'
export * from './domain/project.js'
export * from './domain/events.js'

// ── Contratos ───────────────────────────────────────────────────────────────
export type * from './contracts/common.js'
export type * from './contracts/events.js'
export type * from './contracts/provider.js'
export type * from './contracts/agent.js'
export type * from './contracts/execution.js'
export type * from './contracts/queue.js'
export type * from './contracts/context.js'
export type * from './contracts/memory.js'
export type * from './contracts/governance.js'
export type * from './contracts/state.js'
export type * from './contracts/vcs.js'
export type * from './contracts/plugin.js'
export type * from './contracts/telemetry.js'
export type * from './contracts/kernel.js'
