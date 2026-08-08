import { z } from 'zod'

/**
 * Schema da configuração do Uranus.
 *
 * Config inválida **aborta a inicialização** com a mensagem apontando o caminho
 * do campo. Não existe "seguir com o default e avisar": um orçamento mal escrito
 * que silenciosamente vira o default é R2 (custo descontrolado) esperando para
 * acontecer.
 */

const globs = z.array(z.string())

export const vcsConfigSchema = z.object({
  defaultBranch: z.string().min(1).default('main'),
  branchPrefix: z.string().min(1).default('uranus/'),
  remote: z.string().min(1).default('origin'),
  commitTrailer: z.string().default('Co-Authored-By: Uranus <uranus@local>'),
})

export const projectConfigSchema = z.object({
  name: z.string().min(1),
  vcs: vcsConfigSchema.default({}),
})

export const kernelConfigSchema = z.object({
  /** MVP roda com 1. Paralelismo real depende do lease de arquivo (R6). */
  concurrency: z.number().int().min(1).max(32).default(1),
  tickIntervalMs: z.number().int().min(50).max(60_000).default(1_000),
  maxAttemptsPerTask: z.number().int().min(1).max(20).default(3),
  leaseTtlMs: z.number().int().min(10_000).default(600_000),
  /** Backoff quando a fila está vazia. Evita busy-loop de tick. */
  idleBackoffMs: z.number().int().min(100).default(5_000),
  checkpointEveryTick: z.boolean().default(true),
})

const budgetWindowSchema = z.object({
  usd: z.number().nonnegative(),
  tokens: z.number().int().nonnegative(),
  wallclockMs: z.number().int().nonnegative(),
})

export const budgetConfigSchema = z.object({
  perRun: budgetWindowSchema.default({ usd: 25, tokens: 5_000_000, wallclockMs: 14_400_000 }),
  perTask: budgetWindowSchema.default({ usd: 2, tokens: 400_000, wallclockMs: 900_000 }),
  /** `pause` é o default seguro: nunca continuar gastando após o limite. */
  onExhausted: z.enum(['pause', 'stop', 'ask']).default('pause'),
  warnAtRatio: z.number().min(0).max(1).default(0.8),
})

export const providerConfigSchema = z.object({
  /**
   * `cli` — o modelo edita arquivos por conta própria (Claude Code).
   * `api` — o Uranus controla o laço de ferramentas. É o modo dos modelos
   * locais, e o que verifica permissão a cada chamada em vez de por flag.
   */
  mode: z.enum(['cli', 'api']).default('cli'),
  /** Preset do provider de API: ollama, lmstudio, openai-gpt, openrouter, … */
  preset: z.string().optional(),
  /** Caminho do binário do CLI quando não está no PATH. */
  binary: z.string().optional(),
  model: z.string().optional(),
  /** Versão fixada do binário/CLI — defesa contra drift de API (R5). */
  pinnedVersion: z.string().optional(),
  maxConcurrent: z.number().int().min(1).default(1),
  /** Referência resolvida no momento do uso: `env:MINHA_CHAVE` (R12). */
  apiKeyRef: z.string().optional(),
  baseUrl: z.string().url().optional(),
  /** Baixa por padrão: trabalho de engenharia quer determinismo. */
  temperature: z.number().min(0).max(2).optional(),
  /** Modelo local carregando pesos na 1ª chamada leva minutos. */
  requestTimeoutMs: z.number().int().min(1000).optional(),
  extraArgs: z.array(z.string()).default([]),
})

export const providersConfigSchema = z.object({
  default: z.string().min(1).default('claude-code'),
  fallback: z.array(z.string()).default([]),
  entries: z.record(z.string(), providerConfigSchema).default({}),
  /**
   * Roteamento por papel e por tier — é o que viabiliza o híbrido: modelo
   * forte no Executor (edição multi-turno), modelo local nos gates (uma
   * passada com saída estruturada).
   *
   *   byAgent: { executor: claude-code, reviewer: ollama, security: ollama }
   *   byTier:  { deep: claude-code, balanced: openrouter, fast: ollama }
   */
  byAgent: z.record(z.string(), z.string()).default({}),
  byTier: z.record(z.enum(['fast', 'balanced', 'deep']), z.string()).default({}),
})

export const contextConfigSchema = z.object({
  budgetTokens: z.number().int().min(1_000).default(120_000),
  sections: z
    .record(z.string(), z.number().min(0).max(1))
    .default({ digest: 0.15, code: 0.4, memory: 0.2, task: 0.15, error: 0.1 })
    // Somar mais que 1.0 significaria orçamento que não existe; o packer trataria
    // como implícito e o pack estouraria o limite do modelo silenciosamente (R8).
    .refine(
      (sections) => Object.values(sections).reduce((a, b) => a + b, 0) <= 1.0001,
      'A soma das frações de seção não pode exceder 1.0',
    ),
  cacheTtlMs: z.number().int().min(0).default(300_000),
})

export const schedulerConfigSchema = z.object({
  weights: z.record(z.string(), z.number()).default({
    blockerFirst: 10,
    bugPriority: 6,
    dependencyReady: 1,
    budgetAware: 1,
    mixQuota: 3,
    starvationGuard: 2,
    contextLocality: 1,
    failureCooldown: 2,
    fileLease: 1,
  }),
  mix: z
    .record(z.string(), z.number().min(0).max(1))
    .default({ feature: 0.5, bugfix: 0.25, refactor: 0.15, docs: 0.1 }),
  wipLimit: z.number().int().min(1).default(4),
  failureCooldownMs: z.number().int().min(0).default(120_000),
})

export const integrationConfigSchema = z.object({
  /** ADR-005: PR por padrão. `direct` existe, mas exige opt-in consciente. */
  strategy: z.enum(['pull-request', 'branch-only', 'direct']).default('pull-request'),
  draftPullRequests: z.boolean().default(true),
  requireHumanApproval: z
    .array(
      z.enum([
        'merge',
        'command',
        'dependency',
        'migration',
        'ci-change',
        'budget',
        'force-push',
        'secret-access',
        'custom',
      ]),
    )
    .default(['merge', 'force-push', 'ci-change', 'migration', 'dependency', 'budget']),
  approvalTimeoutMs: z.number().int().min(0).default(0),
})

export const memoryConfigSchema = z.object({
  dir: z.string().default('memory'),
  maxRecordsPerScope: z.number().int().min(10).default(200),
  minConfidence: z.number().min(0).max(1).default(0.3),
  embeddings: z.boolean().default(false),
})

export const permissionsConfigSchema = z.object({
  fsWrite: globs.default(['**']),
  fsDeny: globs.default(['.git/**', '.env', '.env.*', '**/node_modules/**', '.uranus/state.db']),
  execAllow: z.array(z.string()).default([]),
  networkAllow: z.array(z.string()).default([]),
})

const severitySchema = z.enum(['critical', 'high', 'medium', 'low', 'info'])

export const qualityConfigSchema = z.object({
  enabled: z.boolean().default(true),
  /**
   * Ordem importa: o pipeline curto-circuita no primeiro bloqueio, então o
   * gate mais barato e mais decisivo vem primeiro.
   */
  gates: z
    .array(z.object({ agent: z.string().min(1), enabled: z.boolean().default(true) }))
    .default([
      { agent: 'reviewer', enabled: true },
      { agent: 'security', enabled: true },
      { agent: 'qa', enabled: false },
    ]),
  /** Severidade mínima que impede a integração. */
  blockAt: severitySchema.default('high'),
  /** Findings não-bloqueantes viram tasks a partir desta severidade. */
  followUpAt: severitySchema.default('medium'),
  maxFindings: z.number().int().min(1).max(100).default(20),
  /** Agente para onde escalar após falhas repetidas (R3). */
  escalationAgent: z.string().default('bug-hunter'),
})

/**
 * Plugins — duas formas, mesma semântica.
 *
 * A forma curta (`plugins: [node, nextjs]`) é a documentada e cobre o caso
 * comum: "ligue estes, mesmo sem detecção". A forma longa existe para quem
 * precisa desligar um plugin detectado ou passar ajustes por plugin, e é o que
 * o `PluginContext` enxerga em `settings.<id>.*`.
 *
 * Normalizar aqui — em vez de aceitar as duas formas espalhadas pelo código —
 * mantém um único formato a jusante.
 */
const pluginsObjectSchema = z.object({
  enabled: z.array(z.string()).default([]),
  disabled: z.array(z.string()).default([]),
  settings: z.record(z.string(), z.unknown()).default({}),
})

export const pluginsConfigSchema = z.preprocess(
  (raw) => (Array.isArray(raw) ? { enabled: raw } : raw),
  pluginsObjectSchema,
)

export const telemetryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  otlpEndpoint: z.string().url().optional(),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'silent']).default('info'),
})

export const uranusConfigSchema = z.object({
  version: z.literal(1).default(1),
  project: projectConfigSchema,
  kernel: kernelConfigSchema.default({}),
  budget: budgetConfigSchema.default({}),
  providers: providersConfigSchema.default({}),
  context: contextConfigSchema.default({}),
  scheduler: schedulerConfigSchema.default({}),
  integration: integrationConfigSchema.default({}),
  memory: memoryConfigSchema.default({}),
  permissions: permissionsConfigSchema.default({}),
  quality: qualityConfigSchema.default({}),
  telemetry: telemetryConfigSchema.default({}),
  plugins: pluginsConfigSchema.default({}),
})

export type UranusConfig = z.infer<typeof uranusConfigSchema>
export type KernelConfig = z.infer<typeof kernelConfigSchema>
export type BudgetConfig = z.infer<typeof budgetConfigSchema>
export type ProvidersConfig = z.infer<typeof providersConfigSchema>
export type ContextConfig = z.infer<typeof contextConfigSchema>
export type SchedulerConfig = z.infer<typeof schedulerConfigSchema>
export type IntegrationConfig = z.infer<typeof integrationConfigSchema>
export type MemoryConfig = z.infer<typeof memoryConfigSchema>
export type PermissionsConfig = z.infer<typeof permissionsConfigSchema>
export type QualityConfig = z.infer<typeof qualityConfigSchema>
export type TelemetryConfig = z.infer<typeof telemetryConfigSchema>
export type PluginsConfig = z.infer<typeof pluginsConfigSchema>
