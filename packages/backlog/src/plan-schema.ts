import type { JsonSchema } from '@uranus/core'

/**
 * Schema da saída estruturada do `Planner`.
 *
 * Este é o contrato exato do que o modelo pode devolver (ADR-002). Ele é
 * deliberadamente ESTREITO: o plano descreve *o que fazer* e *como verificar*,
 * e nada que se pareça com controle de fluxo — não existe campo "prioridade
 * absoluta", "pule a verificação" ou "faça merge". O que o modelo não consegue
 * expressar, ele não consegue exigir.
 *
 * `additionalProperties: false` em todos os níveis: campo inventado é plano
 * rejeitado, não campo ignorado silenciosamente.
 */
export const PLAN_OUTPUT_SCHEMA: JsonSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'rationale', 'tasks'],
  properties: {
    summary: { type: 'string', minLength: 10, maxLength: 500 },
    rationale: { type: 'string', minLength: 20, maxLength: 4000 },
    risks: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 10 },
    assumptions: { type: 'array', items: { type: 'string', maxLength: 500 }, maxItems: 10 },
    /**
     * Trabalho que este item exige de um projeto VIZINHO (categoria ④).
     *
     * Não vira task na fila deste projeto: vira item de backlog no vizinho,
     * que o Planner de lá decompõe quando rodar. Por isso não pede `touches`
     * nem `acceptance` — exigir aqui seria este projeto legislando sobre a
     * estrutura de arquivos e o modo de verificar do outro.
     *
     * Só é aceito para os aliases que o projeto declarou com
     * `backlogWrite: true`; qualquer outro é plano rejeitado.
     */
    crossProject: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['project', 'title', 'intent'],
        properties: {
          /** Alias do vizinho, exatamente como listado no prompt. */
          project: { type: 'string', minLength: 1, maxLength: 60 },
          title: { type: 'string', minLength: 5, maxLength: 120 },
          intent: { type: 'string', minLength: 20, maxLength: 4000 },
          kind: {
            type: 'string',
            enum: [
              'feature',
              'bugfix',
              'refactor',
              'test',
              'docs',
              'chore',
              'security',
              'perf',
              'deps',
              'infra',
              'migration',
            ],
          },
        },
      },
    },
    tasks: {
      type: 'array',
      minItems: 1,
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ref', 'kind', 'title', 'intent', 'touches', 'acceptance'],
        properties: {
          /** Identificador local do plano (`t1`, `t2`), usado em `dependsOn`. */
          ref: { type: 'string', pattern: '^[a-z0-9_-]{1,20}$' },
          kind: {
            type: 'string',
            enum: [
              'feature',
              'bugfix',
              'refactor',
              'test',
              'docs',
              'chore',
              'security',
              'perf',
              'deps',
              'infra',
              'migration',
            ],
          },
          title: { type: 'string', minLength: 5, maxLength: 120 },
          intent: { type: 'string', minLength: 20, maxLength: 4000 },
          touches: {
            type: 'array',
            minItems: 1,
            maxItems: 12,
            items: { type: 'string', minLength: 1, maxLength: 200 },
          },
          dependsOn: {
            type: 'array',
            maxItems: 8,
            items: { type: 'string', pattern: '^[a-z0-9_-]{1,20}$' },
          },
          acceptance: {
            type: 'object',
            additionalProperties: false,
            required: ['checks'],
            properties: {
              checks: {
                type: 'array',
                minItems: 1,
                maxItems: 8,
                items: { $ref: '#/$defs/check' },
              },
            },
          },
        },
      },
    },
  },
  $defs: {
    check: {
      type: 'object',
      // Um `oneOf` por tipo de check. O Planner NÃO pode inventar um kind novo
      // nem marcar um check como advisory — advisory é decisão do harness.
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'id', 'run'],
          properties: {
            kind: { const: 'command' },
            id: { type: 'string', pattern: '^[a-z0-9-]{1,40}$' },
            run: { type: 'string', minLength: 1, maxLength: 400 },
            expectExit: { type: 'integer', minimum: 0, maximum: 255 },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'id', 'runner'],
          properties: {
            kind: { const: 'tests' },
            id: { type: 'string', pattern: '^[a-z0-9-]{1,40}$' },
            runner: { type: 'string', minLength: 1, maxLength: 40 },
            scope: { type: 'string', enum: ['all', 'related', 'diff'] },
            requireNewTests: { type: 'boolean' },
            forbidSkipped: { type: 'boolean' },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'id', 'path', 'mustExist'],
          properties: {
            kind: { const: 'artifact' },
            id: { type: 'string', pattern: '^[a-z0-9-]{1,40}$' },
            path: { type: 'string', minLength: 1, maxLength: 300 },
            mustExist: { type: 'boolean' },
            matches: { type: 'string', maxLength: 300 },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'id'],
          properties: {
            kind: { const: 'diff' },
            id: { type: 'string', pattern: '^[a-z0-9-]{1,40}$' },
            requireNonEmpty: { type: 'boolean' },
            maxFiles: { type: 'integer', minimum: 1, maximum: 200 },
            maxLines: { type: 'integer', minimum: 1, maximum: 20000 },
          },
        },
      ],
    },
  },
})

/** Forma tipada do que o schema aceita — o validador converte para `TaskDraft`. */
export interface PlannerOutput {
  readonly summary: string
  readonly rationale: string
  readonly risks?: readonly string[]
  readonly assumptions?: readonly string[]
  readonly tasks: readonly PlannerTask[]
  readonly crossProject?: readonly PlannerCrossProjectItem[]
}

/** Necessidade declarada num projeto vizinho. Vira item de backlog LÁ, não task aqui. */
export interface PlannerCrossProjectItem {
  /** Alias do vizinho, entre os que têm `backlogWrite: true`. */
  readonly project: string
  readonly title: string
  readonly intent: string
  readonly kind?: string
}

export interface PlannerTask {
  readonly ref: string
  readonly kind: string
  readonly title: string
  readonly intent: string
  readonly touches: readonly string[]
  readonly dependsOn?: readonly string[]
  readonly acceptance: { readonly checks: readonly PlannerCheck[] }
}

export type PlannerCheck =
  | { kind: 'command'; id: string; run: string; expectExit?: number }
  | {
      kind: 'tests'
      id: string
      runner: string
      scope?: 'all' | 'related' | 'diff'
      requireNewTests?: boolean
      forbidSkipped?: boolean
    }
  | { kind: 'artifact'; id: string; path: string; mustExist: boolean; matches?: string }
  | { kind: 'diff'; id: string; requireNonEmpty?: boolean; maxFiles?: number; maxLines?: number }
