import type {
  BudgetGuard,
  BudgetState,
  BudgetVerdict,
  CostEstimate,
  Money,
  TokenUsage,
} from '@uranus/core'
import { admitBudget, consumeBudget, resetTaskWindow } from '@uranus/core'

/**
 * INV-7 encarnado. Estado mutável mínimo sobre as funções puras do domínio —
 * a lógica de admissão/consumo já está testada em `core`; aqui só mora o estado.
 */
export class DefaultBudgetGuard implements BudgetGuard {
  private current: BudgetState

  constructor(
    initial: BudgetState,
    private readonly warnAtRatio = 0.8,
  ) {
    this.current = initial
  }

  admit(estimate: CostEstimate): BudgetVerdict {
    return admitBudget(this.current, estimate, this.warnAtRatio)
  }

  consume(actual: { usage: TokenUsage; cost: Money; wallclockMs: number }): void {
    // Só o acumulador do run é escrito aqui. `this.current.task` é resetado e
    // checado atomicamente dentro de `admit()` (mesmo turno síncrono), então
    // a admissão continua correta sob N tasks concorrentes; mas `consume()`
    // roda no `finally` de `executeTask`, possivelmente muito depois de outra
    // task já ter resetado essa janela — escrever nela sob concorrência
    // misturaria custo de tasks diferentes. `state().task` fica sempre zerado
    // (honesto: não existe "a task atual" com N em voo), em vez de um valor
    // cruzado sem sentido.
    this.current = {
      ...this.current,
      run: consumeBudget(this.current.run, actual),
    }
  }

  state(): BudgetState {
    return this.current
  }

  resetTask(): void {
    this.current = resetTaskWindow(this.current)
  }

  /** Restaura do checkpoint (recovery). */
  restore(state: BudgetState): void {
    this.current = state
  }
}
