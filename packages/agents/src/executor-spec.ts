import type { AgentSpec } from '@uranus/core'
import { PROMPT_IDS } from '@uranus/prompts'

/**
 * O agente do MVP. Especializações (backend, frontend, etc.) chegam na Fase 5
 * como specs com `specificity` maior — este é o genérico que pega tudo.
 *
 * `successCriteria` aqui é o critério do *agente* (a sessão produziu mudanças?);
 * o critério da *task* vem do `AcceptanceContract` dela. Os dois são verificados.
 */
export const EXECUTOR_SPEC: AgentSpec = {
  name: 'executor',
  version: '1.0.0',
  mission:
    'Transformar uma task bem-especificada em um diff verificável, respeitando o escopo declarado e as convenções do projeto.',
  responsibilities: [
    'Implementar a mudança descrita no intent da task',
    'Escrever ou atualizar testes que provem a mudança',
    'Permanecer estritamente dentro dos globs declarados em touches',
    'Registrar impedimento objetivo em URANUS_BLOCKED.md quando a task for inviável',
  ],
  inputs: { schema: { type: 'object' } },
  outputs: {},
  memory: { read: ['convention', 'pattern', 'stack', 'bug'], write: [] },
  tools: {
    allow: ['Read', 'Glob', 'Grep', 'LS', 'Edit', 'Write', 'MultiEdit', 'Bash'],
    deny: ['WebFetch', 'WebSearch'],
  },
  permissions: {
    tools: { allow: ['*'], deny: [] },
    // `fs.write` efetivo é intersectado com task.touches na admissão.
    fs: { read: ['**'], write: ['**'], deny: ['.git/**', '.env', '.env.*', '.uranus/**'] },
    network: false,
    exec: { allow: ['*'] },
    secrets: { allow: [] },
  },
  successCriteria: {
    checks: [
      {
        kind: 'diff',
        id: 'produced-changes',
        requireNonEmpty: true,
        timeoutMs: 30_000,
      },
    ],
    requireAll: true,
  },
  prompts: {
    system: PROMPT_IDS.executorSystem,
    instruction: PROMPT_IDS.executorInstruction,
  },
  model: { tier: 'balanced' },
  limits: {
    maxTokens: 300_000,
    maxWallclockMs: 15 * 60_000,
    maxTurns: 50,
    maxCost: { micros: 2_000_000, currency: 'USD' },
  },
  handles: ['feature', 'bugfix', 'refactor', 'test', 'docs', 'chore', 'perf', 'deps', 'migration'],
  specificity: 0,
}
