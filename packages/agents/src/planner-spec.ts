import type { AgentSpec } from '@uranus/core'
import { PROMPT_IDS } from '@uranus/prompts'
import { PLAN_OUTPUT_SCHEMA } from '@uranus/backlog'

/**
 * O Planner produz DADOS, não controle (ADR-002).
 *
 * Três consequências visíveis nesta spec:
 *  - `permissions.fs.write` é vazio e `tools` é somente-leitura: o Planner não
 *    consegue tocar em arquivo nenhum, então um plano ruim não deixa rastro;
 *  - `outputs.schema` é o contrato exato do que ele pode devolver;
 *  - `successCriteria` verifica DUAS coisas: que a saída bate com o schema e
 *    que o worktree continua intocado.
 */
export const PLANNER_SPEC: AgentSpec = {
  name: 'planner',
  version: '1.0.0',
  mission:
    'Decompor um item de backlog em tarefas pequenas, independentes e verificáveis, produzindo um plano estruturado que o validador determinístico possa aceitar.',
  responsibilities: [
    'Traduzir intenção em prosa para tarefas com escopo e contrato de aceite explícitos',
    'Usar apenas recursos de verificação que o projeto realmente possui',
    'Declarar dependências entre tarefas que tocam os mesmos arquivos',
    'Nunca escrever código, executar comandos ou alterar o repositório',
  ],
  inputs: { schema: { type: 'object' } },
  outputs: { schema: PLAN_OUTPUT_SCHEMA },
  memory: {
    read: ['architecture', 'convention', 'pattern', 'stack', 'decision', 'roadmap'],
    write: [],
  },
  tools: {
    allow: ['Read', 'Glob', 'Grep', 'LS'],
    deny: ['Edit', 'Write', 'MultiEdit', 'Bash', 'WebFetch', 'WebSearch'],
  },
  permissions: {
    tools: { allow: ['Read', 'Glob', 'Grep', 'LS'], deny: ['*'] },
    fs: { read: ['**'], write: [], deny: ['.git/**', '.env', '.env.*', '.uranus/**'] },
    network: false,
    exec: false,
    secrets: { allow: [] },
  },
  successCriteria: {
    checks: [
      { kind: 'schema', id: 'plano-valido', schema: PLAN_OUTPUT_SCHEMA, timeoutMs: 10_000 },
      // O Planner é somente-leitura: qualquer alteração é violação de contrato.
      {
        kind: 'diff',
        id: 'sem-mutacao',
        maxFiles: 0,
        requirePathsWithin: [],
        timeoutMs: 30_000,
      },
    ],
    requireAll: true,
  },
  prompts: {
    system: PROMPT_IDS.plannerSystem,
    instruction: PROMPT_IDS.plannerInstruction,
  },
  model: { tier: 'deep' },
  limits: {
    maxTokens: 200_000,
    maxWallclockMs: 10 * 60_000,
    maxTurns: 20,
    maxCost: { micros: 1_500_000, currency: 'USD' },
  },
  handles: ['investigation'],
  specificity: 0,
  requires: { structuredOutput: true },
}
