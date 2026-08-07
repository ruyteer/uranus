import type { ApprovalId } from '../ids.js'
import type { Result } from '../result.js'
import type { BudgetState, BudgetVerdict, CostEstimate } from '../domain/budget.js'
import type {
  ApprovalDecision,
  ApprovalRequest,
  PermissionDecision,
  PermissionRequest,
  PermissionSet,
} from '../domain/permission.js'
import type { Money, TokenUsage } from '../domain/usage.js'

export interface PermissionBroker {
  /**
   * Interseção de camadas (agente ∩ plugin ∩ projeto ∩ global).
   * Sempre restringe, nunca amplia — ver `intersectPermissions`.
   */
  resolve(layers: readonly PermissionSet[]): PermissionSet
  evaluate(request: PermissionRequest, effective: PermissionSet): Promise<PermissionDecision>
}

/** INV-7: limite duro. `admit` recusa antes de gastar; `consume` contabiliza o real. */
export interface BudgetGuard {
  admit(estimate: CostEstimate): BudgetVerdict
  consume(actual: {
    readonly usage: TokenUsage
    readonly cost: Money
    readonly wallclockMs: number
  }): void
  state(): BudgetState
  resetTask(): void
}

/**
 * Fila de aprovação humana.
 *
 * `request` bloqueia até haver decisão ou timeout. No timeout vale
 * `ApprovalRequest.defaultOnTimeout`, que nunca é `granted` — uma aprovação
 * que se concede sozinha não é supervisão.
 */
export interface HumanGate {
  request(approval: ApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision>
  pending(): Promise<readonly ApprovalRequest[]>
  resolve(id: ApprovalId, decision: ApprovalDecision): Promise<Result<void>>
}
