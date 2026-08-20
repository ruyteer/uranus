/**
 * Quanto de contexto cabe DE VERDADE na janela do provider escolhido.
 *
 * `context.budgetTokens` é um número só, global. Isso funciona enquanto todos
 * os agentes falam com o mesmo modelo — e deixa de funcionar exatamente no
 * cenário que o roteamento por papel existe para viabilizar: modelo forte no
 * Executor, modelo local nos gates. Um orçamento de 120k entregue a um servidor
 * local com janela de 4k não dá erro: o servidor **descarta o excedente em
 * silêncio** e o modelo responde com convicção sobre um contexto que ele nunca
 * viu. É o pior modo de falha possível, porque parece que funcionou.
 *
 * Aqui o orçamento vira uma função do provider, e o corte fica registrado.
 */

/**
 * Fração da janela que o pack inicial pode ocupar.
 *
 * Não é 1.0 porque o pack não é a única coisa na janela: as definições das
 * ferramentas, o conteúdo dos arquivos que o modelo lê durante o laço, a saída
 * dele e o histórico de turnos disputam o mesmo espaço. Num agente que lê três
 * arquivos antes de editar, o conteúdo lido facilmente supera o pack inicial.
 * Metade é o que sobra para o trabalho depois de montar a mesa.
 */
export const DEFAULT_PACK_SHARE = 0.5

export interface ContextBudgetDecision {
  /** Orçamento a usar no `ContextPacker`. */
  readonly tokens: number
  /** `true` se a janela do provider é que mandou, não a config. */
  readonly clamped: boolean
  readonly configured: number
  readonly providerMaxTokens: number
}

/**
 * Função pura: mesmo provider, mesma config, mesmo orçamento.
 *
 * Nunca devolve mais que `configured` (a config é um teto, não uma meta) nem
 * mais que a fatia da janela do provider.
 */
export function effectiveContextBudget(
  configured: number,
  providerMaxTokens: number,
  packShare: number = DEFAULT_PACK_SHARE,
): ContextBudgetDecision {
  const share = Math.min(1, Math.max(0, packShare))
  // `providerMaxTokens` inválido (0, negativo, NaN) significa provider que não
  // declarou janela. Confiar na config é melhor que zerar o contexto.
  const usable =
    Number.isFinite(providerMaxTokens) && providerMaxTokens > 0
      ? Math.floor(providerMaxTokens * share)
      : configured

  const tokens = Math.max(1, Math.min(configured, usable))
  return {
    tokens,
    clamped: tokens < configured,
    configured,
    providerMaxTokens,
  }
}

/** Mensagem única para log e para `uranus provider test`. */
export function explainContextClamp(decision: ContextBudgetDecision, providerId: string): string {
  return (
    `contexto reduzido de ${String(decision.configured)} para ${String(decision.tokens)} tokens: ` +
    `"${providerId}" declara janela de ${String(decision.providerMaxTokens)}. ` +
    'Sem este corte o servidor descartaria o excedente sem avisar.'
  )
}
