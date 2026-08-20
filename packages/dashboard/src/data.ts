import type { Result, Task } from '@uranus/core'

/**
 * A porta de dados do painel — o que ele precisa para ESCREVER.
 *
 * O painel não conhece `StateStore`, `FileBacklogStore` nem o arquivo de
 * config: recebe esta interface pronta do composition root. Duas razões, e
 * nenhuma delas é purismo:
 *
 *  - a dependência é ao contrário. `@uranus/cli` depende de `@uranus/dashboard`;
 *    importar `CONFIG_CATEGORIES` ou `StoredBacklogItem` daqui fecharia um
 *    ciclo. Por isso os tipos `*Like` abaixo são ESTRUTURAIS — descrevem a
 *    forma mínima que a tela usa, e os tipos reais do CLI se encaixam neles
 *    sem conversão;
 *  - `data` é opcional. Ausente, as rotas de escrita devolvem 503 e o painel
 *    continua exatamente o que era: um observador do log de eventos. Um
 *    `uranus dashboard` apontado para um projeto que não é seu não deveria
 *    ganhar poder de escrita por acidente.
 */
export interface DashboardData {
  readonly tasks: DashboardTasksPort
  readonly backlog: DashboardBacklogPort
  readonly config: DashboardConfigPort
  /**
   * Ausente só em painel muito antigo/sem projeto anexado — em qualquer
   * projeto com `.uranus/` a porta existe. Opcional para não quebrar quem
   * construía `DashboardData` à mão antes desta aba existir.
   */
  readonly instructions?: DashboardInstructionsPort
  readonly skills?: DashboardSkillsPort
  readonly vault?: DashboardVaultPort
  readonly graphify?: DashboardGraphifyPort
  readonly memory?: DashboardMemoryPort
  readonly github?: DashboardGitHubPort
}

export interface DashboardTasksPort {
  list(): Promise<readonly Task[]>
  create(input: NewTaskInput): Promise<Result<Task>>
  /**
   * `state` chega como string crua de propósito: quem sabe se a transição é
   * legal é a máquina de estados de `@uranus/core`, do outro lado da porta. O
   * painel repetir essa regra criaria duas autoridades sobre o mesmo assunto —
   * e a que fica desatualizada é sempre a da tela.
   */
  setState(id: string, state: string, reason?: string): Promise<Result<Task>>
  remove(id: string): Promise<Result<void>>
}

/**
 * O formulário de criação de task, que o `tasks.md` pede que seja "mais fácil
 * de escrever do que YAML". Campos crus: montar `AcceptanceContract`, escolher
 * `maxAttempts` a partir da config e gerar o id é trabalho do composition root,
 * que tem o projeto em mãos.
 */
export interface NewTaskInput {
  readonly kind: string
  readonly title: string
  readonly intent: string
  readonly touches: readonly string[]
  /** `CheckKind`s marcados na tela (`tests`, `diff`, ...). Ver `CHECK_KINDS`. */
  readonly checks: readonly string[]
}

/**
 * `CheckKind` de `@uranus/core` como lista.
 *
 * Está escrita aqui porque o core exporta o tipo (`Check['kind']`) e não um
 * array — e a tela precisa de valores para desenhar as caixas de seleção. Se
 * um `kind` novo aparecer lá, esta lista é o lugar a atualizar.
 */
export const CHECK_KINDS: readonly string[] = Object.freeze([
  'command',
  'tests',
  'coverage',
  'diff',
  'artifact',
  'schema',
  'plugin',
])

export interface DashboardBacklogPort {
  list(): Promise<readonly StoredBacklogItemLike[]>
  create(input: {
    title: string
    body: string
    priority?: number
    labels?: string[]
  }): Promise<Result<StoredBacklogItemLike>>
  /**
   * O patch é validado por esta camada antes de chegar aqui: só as chaves
   * conhecidas (`title`, `body`, `priority`, `state`, `labels`) e já com o tipo
   * certo. `Record<string, unknown>` é a forma que atravessa a fronteira sem o
   * pacote precisar conhecer `StoredBacklogItem`.
   */
  update(id: string, patch: Record<string, unknown>): Promise<Result<StoredBacklogItemLike>>
  remove(id: string): Promise<Result<void>>
}

/** Estrutural: `StoredBacklogItem` de `@uranus/backlog` se encaixa como está. */
export interface StoredBacklogItemLike {
  readonly id: string
  readonly title: string
  readonly body: string
  readonly labels: readonly string[]
  readonly priority: number
  readonly source: string
  readonly state: string
  readonly planId?: string
  readonly lastRejections?: readonly string[]
  readonly planningFailures?: number
  readonly createdAt: number
  readonly startedAt?: number
}

export interface DashboardInstructionsPort {
  list(): Promise<readonly InstructionNoteLike[]>
  create(input: { title: string; body: string; scope?: string }): Promise<Result<InstructionNoteLike>>
  /** `scope: null` limpa o escopo (a instrução volta a valer para o projeto inteiro). */
  update(
    id: string,
    patch: { title?: string; body?: string; scope?: string | null },
  ): Promise<Result<InstructionNoteLike>>
  remove(id: string): Promise<Result<void>>
}

/** Estrutural: `InstructionNote` de `@uranus/cli` (`instructions.ts`) se encaixa como está. */
export interface InstructionNoteLike {
  readonly id: string
  readonly title: string
  readonly scope?: string
  readonly body: string
  readonly createdAt: number
  readonly updatedAt: number
}

export interface DashboardSkillsPort {
  list(): Promise<readonly SkillCatalogEntryLike[]>
  install(id: string): Promise<Result<{ readonly id: string }>>
}

/** Estrutural: `SkillCatalogEntry` de `@uranus/cli` + a flag `installed` calculada. */
export interface SkillCatalogEntryLike {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly official: boolean
  readonly sourceRepo: string
  readonly sourceUrl: string
  readonly installed: boolean
}

export interface DashboardVaultPort {
  graph(): Promise<VaultGraphLike>
}

/** Estrutural: `VaultGraph` de `@uranus/cli` (`vault.ts`) se encaixa como está. */
export interface VaultGraphLike {
  readonly nodes: readonly VaultNodeLike[]
  readonly edges: readonly { readonly from: string; readonly to: string }[]
  readonly unresolved: readonly string[]
}

export interface VaultNodeLike {
  readonly id: string
  readonly title: string
  /** `memory` | `backlog` | `instruction`. */
  readonly kind: string
  readonly scope?: string
  readonly excerpt: string
}

export interface DashboardGraphifyPort {
  graph(): Promise<GraphifyGraphLike>
}

/**
 * Estrutural: `GraphifyGraph` de `@uranus/cli` (`graphify.ts`) se encaixa
 * como está. Ao contrário do vault (calculado na hora a partir de memória/
 * backlog/instruções), este grafo é uma leitura de `graphify-out/graph.json`
 * — um snapshot de quando a skill `/graphify` rodou por último, não algo que
 * o painel recalcula.
 */
export interface GraphifyGraphLike {
  readonly nodes: readonly GraphifyNodeLike[]
  readonly edges: readonly { readonly from: string; readonly to: string; readonly relation?: string }[]
  readonly communities: readonly { readonly id: number; readonly label?: string; readonly size: number }[]
  readonly godNodes: readonly { readonly id: string; readonly title: string; readonly degree: number }[]
}

export interface GraphifyNodeLike {
  readonly id: string
  readonly title: string
  readonly fileType?: string
  readonly sourceFile?: string
  readonly sourceLocation?: string
  readonly community?: number
  readonly communityName?: string
}

export interface DashboardMemoryPort {
  list(): Promise<readonly MemoryRecordLike[]>
  create(input: NewMemoryInput): Promise<Result<MemoryRecordLike>>
  /**
   * Observa mudanças na fonte de memória feitas por OUTRO processo (kernel
   * rodando em outro terminal, `uranus chat`, edição manual em
   * `.uranus/memory/`) e chama `onChange`. Devolve a função de cancelamento.
   *
   * Opcional: sem isto, o painel ainda converge — só que pelo poll de 10s do
   * cliente, e só na aba que estiver aberta no momento, em vez de quase
   * imediato via SSE.
   */
  watch?(onChange: () => void): () => void
}

export interface NewMemoryInput {
  readonly scope: string
  readonly title: string
  readonly body: string
  readonly tags?: readonly string[]
  readonly confidence?: number
}

/** Estrutural: `MemoryRecord` de `@uranus/core` se encaixa como está. */
export interface MemoryRecordLike {
  readonly id: string
  readonly scope: string
  readonly key: string
  readonly title: string
  readonly body: string
  readonly tags: readonly string[]
  readonly confidence: number
  readonly source: { readonly kind: string; readonly ref: string }
  readonly validFrom: number
  readonly supersededBy?: string
}

export interface DashboardGitHubPort {
  overview(): Promise<Result<GitHubOverviewLike>>
  reviewPullRequest(
    repo: string,
    number: number,
    action: 'approve' | 'request-changes' | 'comment',
    body?: string,
  ): Promise<Result<void>>
  mergePullRequest(repo: string, number: number, method: 'merge' | 'squash' | 'rebase'): Promise<Result<void>>
  closePullRequest(repo: string, number: number): Promise<Result<void>>
}

/** Estrutural: `GitHubOverview` de `@uranus/cli` (`git-control.ts`) se encaixa como está. */
export interface GitHubOverviewLike {
  readonly pulls: readonly PullRequestLike[]
  readonly branches: readonly BranchLike[]
  readonly commits: readonly CommitLike[]
  /**
   * Projeto com mais de um repositório (ex.: duas pastas irmãs, cada uma seu
   * `.git`): um repositório que falhou (sem remote, `gh` não autenticado ali)
   * aparece aqui em vez de derrubar a tela inteira — os outros continuam
   * valendo em `pulls`/`branches`/`commits`.
   */
  readonly repoErrors: readonly RepoErrorLike[]
}

export interface RepoErrorLike {
  readonly repo: string
  readonly message: string
}

export interface PullRequestLike {
  readonly number: number
  readonly title: string
  readonly author: string
  readonly url: string
  readonly branch: string
  readonly baseBranch: string
  readonly isDraft: boolean
  readonly reviewDecision: string
  readonly mergeable: string
  readonly checksState: string
  readonly additions: number
  readonly deletions: number
  readonly updatedAt: number
  readonly repo: string
}

export interface BranchLike {
  readonly name: string
  readonly current: boolean
  readonly lastCommitSha: string
  readonly lastCommitAt: number
  readonly lastCommitSubject: string
  readonly repo: string
}

export interface CommitLike {
  readonly sha: string
  readonly shortSha: string
  readonly author: string
  readonly at: number
  readonly subject: string
  readonly repo: string
}

export interface DashboardConfigPort {
  /** `CONFIG_CATEGORIES` do wizard do CLI — as perguntas vêm de lá, não daqui. */
  categories(): readonly ConfigCategoryLike[]
  /**
   * Valores efetivos e de onde vieram, **indexados pelo mesmo `path` das
   * perguntas** (`budget.perRun.usd`, `validations.rules.scope`). É plano e não
   * aninhado porque é assim que a tela consome: uma pergunta, uma busca.
   */
  effective(): Promise<{ values: Record<string, unknown>; origins: Record<string, string> }>
  set(path: string, value: unknown): Promise<Result<void>>
}

/** Estrutural: `ConfigCategory` de `@uranus/cli` se encaixa como está. */
export interface ConfigCategoryLike {
  readonly id: string
  readonly title: string
  readonly blurb: string
  readonly questions: readonly ConfigQuestionLike[]
}

export interface ConfigQuestionLike {
  readonly path: string
  readonly label: string
  readonly help: string
  /** `text` | `number` | `select` | `multiselect` | `confirm`. */
  readonly kind: string
  readonly options?: readonly ConfigOptionLike[]
  readonly min?: number
  readonly max?: number
}

export interface ConfigOptionLike {
  readonly value: string
  readonly label: string
  readonly hint?: string
}
