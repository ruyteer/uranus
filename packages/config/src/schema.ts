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
  /**
   * 10, e não 3: desde que falha de validação passou a ter contador próprio
   * (`validations.countTowardAttempts`), este número conta apenas defeito real
   * de execução — e três tentativas era pouco para isso. Quem quiser o
   * comportamento antigo declara `maxAttemptsPerTask: 3`.
   */
  maxAttemptsPerTask: z.number().int().min(1).max(20).default(10),
  leaseTtlMs: z.number().int().min(10_000).default(600_000),
  /** Backoff quando a fila está vazia. Evita busy-loop de tick. */
  idleBackoffMs: z.number().int().min(100).default(5_000),
  checkpointEveryTick: z.boolean().default(true),
})

export const backlogConfigSchema = z.object({
  /** `uranus start` planeja itens `open` sozinho, um por vez, sem `uranus plan`. */
  autoPlan: z.boolean().default(true),
  /**
   * Quantas vezes um item pode ter o plano recusado antes de ser deixado de
   * lado. Sem teto, um item que o Planner nunca consegue planejar prende o
   * kernel para sempre e gasta dinheiro a cada tentativa.
   */
  maxPlanningFailures: z.number().int().min(1).max(10).default(2),
})

const budgetWindowSchema = z.object({
  usd: z.number().nonnegative(),
  tokens: z.number().int().nonnegative(),
  wallclockMs: z.number().int().nonnegative(),
})

export const budgetConfigSchema = z.object({
  /**
   * Tokens bem mais folgados que dólar de propósito: numa sessão CLI longa
   * (Claude Code em modo agente, muitos turnos de ferramenta), a maior parte
   * dos tokens contados é leitura de CACHE de prompt — o mesmo contexto
   * relido a cada turno — que custa ~10x menos que token novo, mas
   * `totalTokens()` soma tudo com peso igual pra fins de orçamento. Um teto
   * de tokens calibrado pra "token = dinheiro" estoura muito antes do
   * dólar de verdade estourar (visto em produção: $2,64 de $10 usados, mas
   * já 244% do teto de tokens) — o dólar já é o limite que reflete gasto
   * real; tokens aqui é rede de segurança generosa pro caso de estouro de
   * verdade, não o limite que deveria morder primeiro.
   */
  perRun: budgetWindowSchema.default({ usd: 25, tokens: 30_000_000, wallclockMs: 14_400_000 }),
  /**
   * O limite por task precisa comportar o **maior** agente do catálogo, ou esse
   * agente nunca é admitido e some do sistema sem aviso. O `bug-hunter` — o
   * especialista para onde a task escala depois de falhas repetidas (R3) — pede
   * até US$3, 20 min e 400k tokens. Com o antigo default de US$2/15 min, a
   * escalada era recusada na admissão e a task morria com "orçamento
   * insuficiente" em vez do diagnóstico real. `uranus doctor` avisa quando
   * algum agente registrado não cabe aqui.
   */
  perTask: budgetWindowSchema.default({ usd: 3, tokens: 3_000_000, wallclockMs: 1_200_000 }),
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
  /**
   * Janela real do servidor, em tokens. Só para providers locais.
   *
   * Em servidor local a janela é propriedade de como o servidor subiu, não do
   * modelo: o Ollama usa `num_ctx` (4096 por padrão) e, ao estourar, descarta
   * o excedente **sem erro**. O default assumido é conservador de propósito.
   * Subiu com `OLLAMA_CONTEXT_LENGTH=32768`? Declare 32768 aqui.
   */
  contextLength: z.number().int().min(512).optional(),
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
  /**
   * Dias após supersessão até um registro ser removido do disco e do cache
   * em processo (Fase 9). `compact()` só supersede, nunca apaga — isto é o
   * que de fato limita o crescimento num run de longa duração.
   */
  pruneSupersededAfterDays: z.number().int().min(1).default(30),
})

/**
 * Espelha `MemoryScope` de `@uranus/core` — repetido aqui (não importado) pra
 * manter o schema de config zod-only, mesmo padrão de `severitySchema`.
 */
const linkedMemoryScopeSchema = z.enum([
  'architecture',
  'decision',
  'bug',
  'preference',
  'stack',
  'pattern',
  'convention',
  'roadmap',
  'history',
  'context',
])

export const linkedProjectConfigSchema = z.object({
  /** Caminho pro `.uranus` do projeto vizinho, relativo à raiz deste projeto. */
  path: z.string().min(1),
  /** Rótulo mostrado no contexto (ex.: "[core] Memória [...]"). Default: nome da pasta. */
  alias: z.string().min(1).optional(),
  /** Quais escopos de memória do vizinho entram no contexto. */
  scopes: z.array(linkedMemoryScopeSchema).default(['convention', 'architecture']),
  limit: z.number().int().min(1).max(50).default(6),
  /**
   * Permite ao Uranus CRIAR itens no backlog deste vizinho.
   *
   * Escrever no repo de outro projeto é decisão que se toma, não que se
   * herda — por isso o default é `false`, mesmo critério do host do dashboard.
   * A memória do vizinho continua somente-leitura em qualquer caso: a exceção
   * aberta aqui é estreita e vale só para `.uranus/backlog`.
   */
  backlogWrite: z.boolean().default(false),
  /**
   * Uma linha sobre o que é este projeto ("API REST em Fastify").
   *
   * Vai para o prompt do Planner junto do alias: sem isso, ele só vê um nome
   * e teria de adivinhar se "core" é o backend ou a lib de componentes — e um
   * item de backlog criado no vizinho errado é pior que nenhum.
   */
  description: z.string().min(1).max(200).optional(),
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
  /**
   * Severidade mínima que impede a integração. `'never'`: a cadeia de
   * qualidade roda e registra achados, mas nunca bloqueia — perfil advisory.
   */
  blockAt: z.union([severitySchema, z.literal('never')]).default('high'),
  /**
   * Findings não-bloqueantes viram tasks a partir desta severidade.
   *
   * O default é igual a `blockAt` de propósito: só vira trabalho automático o
   * achado que de fato parou a integração. Era `medium`, e `medium` é onde um
   * agente de revisão coloca tudo de que não gosta — o resultado era uma fila
   * que crescia sozinha. Baixe para `medium` se quiser o comportamento antigo;
   * `followUp.*` abaixo continua servindo de rede.
   */
  followUpAt: severitySchema.default('high'),
  maxFindings: z.number().int().min(1).max(100).default(20),
  /**
   * Contenção da cadeia de correções.
   *
   * Toda task concluída é revisada, e toda revisão pode gerar correção — que
   * ao concluir é revisada de novo. Sem caso base, essa recorrência não
   * termina. Estes três limites são o caso base, e são checados em código puro
   * (`planFollowUps`), nunca pelo modelo.
   */
  followUp: z
    .object({
      /**
       * Profundidade máxima da árvore de correções.
       *
       * `1` (default): a task que você pediu pode gerar correções; as
       * correções são revisadas normalmente, mas os achados delas viram
       * backlog em vez de mais tasks. `0` desliga a derivação automática.
       */
      maxGeneration: z.number().int().min(0).max(5).default(1),
      /** Teto de tasks derivadas por run, somando todas as tasks e gates. */
      maxPerRun: z.number().int().min(0).max(200).default(8),
      /**
       * Categorias que informam mas não geram trabalho automático. Elas ainda
       * aparecem no backlog. Vazio herda o default do core.
       */
      denyCategories: z.array(z.string()).default([]),
    })
    .default({}),
  /** Agente para onde escalar após falhas repetidas (R3). */
  escalationAgent: z.string().default('bug-hunter'),
})

/**
 * Espelham `ValidationRule` e `ValidationSeverity` de `@uranus/core` — repetidos
 * aqui pelo mesmo motivo de `linkedMemoryScopeSchema`: manter o schema zod-only.
 */
const validationRuleSchema = z.enum([
  'scope',
  'diffSize',
  'forbiddenPaths',
  'emptyDiff',
  'tests',
  'requireNewTests',
  'forbidSkipped',
  'lint',
  'types',
  'schema',
])

const validationSeveritySchema = z.enum(['off', 'advisory', 'blocking'])

export const validationsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  /**
   * Parcial: o que não vier aqui mantém a severidade do core
   * (`DEFAULT_VALIDATION_POLICY.rules`, tudo `blocking`). Um projeto existente
   * não pode afrouxar por atualização — só por decisão declarada.
   */
  rules: z.record(validationRuleSchema, validationSeveritySchema).default({}),
  /**
   * `false`: reprovação de validação não gasta tentativa de execução. É o que
   * impede uma violação de escopo de escalar até `blocked` e replanejamento —
   * o caminho que fazia a fila crescer sem nada ser corrigido.
   */
  countTowardAttempts: z.boolean().default(false),
  /** Reparos dirigidos por task antes de a falha virar tentativa de verdade. */
  maxRepairAttempts: z.number().int().min(0).max(10).default(3),
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

const modelPricingSchema = z.object({
  model: z.string().min(1),
  inputPerMillion: z.number().min(0),
  outputPerMillion: z.number().min(0),
  cacheReadPerMillion: z.number().min(0).default(0),
  cacheWritePerMillion: z.number().min(0).default(0),
  /** ISO ou epoch. Preço antigo continua valendo para run antigo. */
  effectiveFrom: z
    .union([z.string(), z.number()])
    .default(0)
    .transform((value) => (typeof value === 'number' ? value : Date.parse(value) || 0)),
})

export const dashboardConfigSchema = z.object({
  enabled: z.boolean().default(false),
  port: z.number().int().min(0).max(65535).default(4319),
  /**
   * Loopback por padrão, e isto não é conservadorismo gratuito: o painel mostra
   * o código do projeto e concede aprovações. Fora de loopback o servidor exige
   * `token` e se recusa a subir sem ele.
   */
  host: z.string().default('127.0.0.1'),
  token: z.string().optional(),
  /** Abre o navegador ao subir. */
  open: z.boolean().default(false),
})

export const eventRetentionConfigSchema = z.object({
  /**
   * Quantos segmentos JSONL manter antes de podar os mais antigos. O segmento
   * atual (sendo escrito) nunca é podado. Default generoso de propósito:
   * profundidade de auditoria histórica vs. disco limitado (Fase 9) — o mesmo
   * trade-off já aceito pela poda de checkpoint.
   */
  keepSegments: z.number().int().min(1).default(200),
})

export const telemetryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  otlpEndpoint: z.string().url().optional(),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'silent']).default('info'),
  dashboard: dashboardConfigSchema.default({}),
  /**
   * Correções da tabela de preços, por provider. O embutido envelhece; isto é
   * o conserto sem esperar release.
   */
  pricing: z.record(z.string(), z.array(modelPricingSchema)).default({}),
  eventRetention: eventRetentionConfigSchema.default({}),
})

export const uranusConfigSchema = z.object({
  version: z.literal(1).default(1),
  project: projectConfigSchema,
  kernel: kernelConfigSchema.default({}),
  backlog: backlogConfigSchema.default({}),
  budget: budgetConfigSchema.default({}),
  providers: providersConfigSchema.default({}),
  context: contextConfigSchema.default({}),
  scheduler: schedulerConfigSchema.default({}),
  integration: integrationConfigSchema.default({}),
  memory: memoryConfigSchema.default({}),
  permissions: permissionsConfigSchema.default({}),
  quality: qualityConfigSchema.default({}),
  validations: validationsConfigSchema.default({}),
  telemetry: telemetryConfigSchema.default({}),
  plugins: pluginsConfigSchema.default({}),
  /**
   * Projetos vizinhos (ex.: backend/frontend em repos separados, cada um com
   * seu próprio `.uranus`) cuja memória entra como contexto somente-leitura.
   * Não une backlog, orçamento nem fila — só empresta conhecimento.
   */
  linkedProjects: z.array(linkedProjectConfigSchema).default([]),
})

export type UranusConfig = z.infer<typeof uranusConfigSchema>
export type KernelConfig = z.infer<typeof kernelConfigSchema>
export type BacklogConfig = z.infer<typeof backlogConfigSchema>
export type BudgetConfig = z.infer<typeof budgetConfigSchema>
export type ProvidersConfig = z.infer<typeof providersConfigSchema>
export type ContextConfig = z.infer<typeof contextConfigSchema>
export type SchedulerConfig = z.infer<typeof schedulerConfigSchema>
export type IntegrationConfig = z.infer<typeof integrationConfigSchema>
export type MemoryConfig = z.infer<typeof memoryConfigSchema>
export type PermissionsConfig = z.infer<typeof permissionsConfigSchema>
export type LinkedProjectConfig = z.infer<typeof linkedProjectConfigSchema>
export type QualityConfig = z.infer<typeof qualityConfigSchema>
export type ValidationsConfig = z.infer<typeof validationsConfigSchema>
export type TelemetryConfig = z.infer<typeof telemetryConfigSchema>
export type DashboardConfig = z.infer<typeof dashboardConfigSchema>
export type PluginsConfig = z.infer<typeof pluginsConfigSchema>
