import type {
  ApprovalDecision,
  ApprovalId,
  ApprovalRequest,
  Clock,
  HumanGate,
  Logger,
  Result,
} from '@uranus/core'
import { NotFoundError, err, ok } from '@uranus/core'

interface PendingApproval {
  readonly request: ApprovalRequest
  readonly resolve: (decision: ApprovalDecision) => void
}

/**
 * Fila de aprovação humana em memória (Fase 2).
 *
 * `request` bloqueia até `resolve` (via CLI `uranus task approve`) ou timeout.
 * No timeout vale `defaultOnTimeout` — que nunca é conceder. Uma aprovação que
 * se concede sozinha por silêncio não é supervisão; é a ausência dela.
 */
export class InMemoryHumanGate implements HumanGate {
  private readonly pendingMap = new Map<ApprovalId, PendingApproval>()

  constructor(
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly timeoutMs = 0, // 0 = espera para sempre (ou até abort)
  ) {}

  request(approval: ApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision> {
    this.logger.warn('Aprovação humana pendente', {
      id: approval.id,
      kind: approval.kind,
      title: approval.title,
    })

    return new Promise<ApprovalDecision>((resolve) => {
      const entry: PendingApproval = {
        request: approval,
        resolve: (decision) => {
          cleanup()
          resolve(decision)
        },
      }
      this.pendingMap.set(approval.id, entry)

      let timer: NodeJS.Timeout | undefined
      if (this.timeoutMs > 0) {
        timer = setTimeout(() => {
          cleanup()
          resolve({
            effect: 'denied',
            by: 'timeout',
            at: this.clock.now(),
            reason: `sem resposta em ${String(this.timeoutMs)}ms (defaultOnTimeout=${approval.defaultOnTimeout})`,
          })
        }, this.timeoutMs)
      }

      const onAbort = (): void => {
        cleanup()
        resolve({
          effect: 'denied',
          by: 'kernel',
          at: this.clock.now(),
          reason: 'run interrompido com aprovação pendente',
        })
      }
      signal.addEventListener('abort', onAbort, { once: true })

      const cleanup = (): void => {
        this.pendingMap.delete(approval.id)
        if (timer !== undefined) clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
      }
    })
  }

  pending(): Promise<readonly ApprovalRequest[]> {
    return Promise.resolve([...this.pendingMap.values()].map((entry) => entry.request))
  }

  resolve(id: ApprovalId, decision: ApprovalDecision): Promise<Result<void>> {
    const entry = this.pendingMap.get(id)
    if (entry === undefined) {
      return Promise.resolve(
        err(new NotFoundError('Aprovação não está pendente', { context: { id } })),
      )
    }
    entry.resolve(decision)
    return Promise.resolve(ok())
  }
}
