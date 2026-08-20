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
    'Satisfazer exatamente o contrato de aceite da task — teste só quando o contrato pedir',
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
  // `security` está aqui de propósito: `findingsToTaskDrafts` (gate-pipeline.ts)
  // dá esse kind às tasks de correção nascidas de achados do agente Security —
  // mas o Security é só-leitura (não escreve arquivo) e seu prompt só funciona
  // como gate (`diff`/`conventions` vêm de fora, via `runGate`). Sem o Executor
  // aqui, essas tasks roteavam de volta pro próprio Security por `handles`,
  // que nem consegue corrigir nada nem renderiza o prompt fora do gate. Em
  // empate de `specificity`, o desempate é alfabético — "executor" < "security"
  // — então o Executor sempre vence essa rota, mesmo sem tocar em security.yaml.
  handles: [
    'feature',
    'bugfix',
    'refactor',
    'test',
    'docs',
    'chore',
    'perf',
    'deps',
    'migration',
    'security',
  ],
  specificity: 0,
}
