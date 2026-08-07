import type {
  ApprovalRequest,
  PermissionBroker,
  PermissionDecision,
  PermissionRequest,
  PermissionSet,
} from '@uranus/core'
import { intersectAll, isAllowed, matchesAny, newApprovalId } from '@uranus/core'

export class DefaultPermissionBroker implements PermissionBroker {
  constructor(private readonly now: () => number) {}

  resolve(layers: readonly PermissionSet[]): PermissionSet {
    return intersectAll(layers)
  }

  evaluate(request: PermissionRequest, effective: PermissionSet): Promise<PermissionDecision> {
    return Promise.resolve(this.decide(request, effective))
  }

  private decide(request: PermissionRequest, effective: PermissionSet): PermissionDecision {
    switch (request.axis) {
      case 'tool': {
        if (matchesAny(request.subject, effective.tools.deny)) {
          return { effect: 'deny', reason: `ferramenta "${request.subject}" está em deny` }
        }
        if (
          effective.tools.allow.includes('*') ||
          matchesAny(request.subject, effective.tools.allow)
        ) {
          return { effect: 'allow' }
        }
        return { effect: 'deny', reason: `ferramenta "${request.subject}" não está em allow` }
      }

      case 'fs-read':
        return isAllowed(request.subject, effective.fs.read, effective.fs.deny)
          ? { effect: 'allow' }
          : { effect: 'deny', reason: `leitura fora do escopo: ${request.subject}` }

      case 'fs-write':
        return isAllowed(request.subject, effective.fs.write, effective.fs.deny)
          ? { effect: 'allow' }
          : { effect: 'deny', reason: `escrita fora do escopo: ${request.subject} (INV-5)` }

      case 'network': {
        if (effective.network === false) {
          return { effect: 'deny', reason: 'rede desligada para este agente' }
        }
        return effective.network.allow.includes('*') ||
          effective.network.allow.includes(request.subject)
          ? { effect: 'allow' }
          : { effect: 'deny', reason: `host fora do allow: ${request.subject}` }
      }

      case 'exec': {
        if (effective.exec === false) {
          return { effect: 'deny', reason: 'execução de comandos desligada' }
        }
        if (
          effective.exec.allow.includes('*') ||
          effective.exec.allow.some((pattern) => request.subject.startsWith(pattern))
        ) {
          return { effect: 'allow' }
        }
        // Comando fora do allow não é negado seco: vira pedido de aprovação
        // humana (§15.2) — o humano decide, não o modelo.
        return { effect: 'ask', approval: this.approvalFor(request) }
      }

      case 'secret':
        return effective.secrets.allow.includes('*') ||
          effective.secrets.allow.includes(request.subject)
          ? { effect: 'allow' }
          : { effect: 'ask', approval: this.approvalFor(request) }
    }
  }

  private approvalFor(request: PermissionRequest): ApprovalRequest {
    return {
      id: newApprovalId(this.now()),
      kind: request.axis === 'secret' ? 'secret-access' : 'command',
      title: `Permissão: ${request.axis} → ${request.subject}`,
      detail: `Agente "${request.agent ?? '?'}" pediu ${request.axis} sobre "${request.subject}".`,
      risk: 'medium',
      ...(request.taskId === undefined ? {} : { taskId: request.taskId }),
      requestedAt: this.now(),
      defaultOnTimeout: 'deny', // nunca 'allow'
    }
  }
}
