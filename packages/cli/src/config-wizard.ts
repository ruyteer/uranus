import type { Document } from 'yaml'
import { parseDocument } from 'yaml'
import type { ProjectDigest, ValidationRule, ValidationSeverity } from '@uranus/core'
import { VALIDATION_RULES, resolveValidationPolicy } from '@uranus/core'
import type { ConfigLayer, UranusConfig } from '@uranus/config'
import { VALIDATION_SEVERITY_LABEL } from './task-view.js'
import type { ConfigWrite } from './config-file.js'
import {
  applyWrites,
  cloneDocument,
  documentToData,
  formatConfigValue,
  pathSegments,
  sameValue,
  validateProjectData,
  valueAtPath,
} from './config-file.js'
import type { PromptIo, PromptOption } from './prompt-kit.js'
import { ask, askNumber, confirm, multiselect, select } from './prompt-kit.js'

/**
 * O wizard de configuração declarado como **dado**, não como sequência de
 * perguntas em código.
 *
 * O motivo é concreto: o painel web precisa oferecer o mesmo editor de
 * configuração, e com a definição declarada ele reaproveita estas perguntas,
 * estes defaults e estes textos de ajuda em vez de reimplementá-los — as duas
 * telas não têm como divergir. A parte imperativa deste arquivo (`askQuestion`,
 * `runConfigWizard`) é só a renderização desta tabela num terminal.
 *
 * O público é leigo: todo `help` explica a CONSEQUÊNCIA em português simples.
 * Uma pergunta sem ajuda é uma pergunta que o dono do projeto responde no chute
 * — e `config-wizard.test.ts` recusa que ela exista.
 */

export type QuestionKind = 'text' | 'number' | 'select' | 'multiselect' | 'confirm'

/** O que uma pergunta devolve. Casa com `QuestionKind`, nesta ordem. */
export type PromptAnswer = string | number | boolean | readonly string[]

export interface ConfigQuestion {
  /** Caminho no YAML: `budget.perRun.usd`, `validations.rules.scope`. */
  readonly path: string
  readonly label: string
  /** Uma ou duas linhas explicando a CONSEQUÊNCIA, para leigo. Obrigatório. */
  readonly help: string
  readonly kind: QuestionKind
  readonly options?: readonly PromptOption<string>[]
  readonly min?: number
  readonly max?: number
  /** Sugestão a partir da detecção do projeto. Só vale quando o campo está vazio. */
  readonly suggest?: (digest: ProjectDigest | undefined) => PromptAnswer | undefined
  /** Valor gravado → resposta mostrada como padrão. Só quando os dois diferem. */
  readonly decode?: (stored: unknown) => PromptAnswer | undefined
  /**
   * Resposta → o que gravar. O default é gravar a resposta em `path`.
   *
   * Existe porque uma escolha às vezes implica mais de um campo (escolher um
   * provider de API sem declarar a entrada dele deixaria a config apontando
   * para um provider que não existe), e porque uma lista de nomes às vezes é
   * gravada como lista de objetos (`quality.gates`).
   */
  readonly writes?: (answer: PromptAnswer, current: unknown) => readonly ConfigWrite[]
}

export interface ConfigCategory {
  readonly id: string
  readonly title: string
  /** Para que serve esta categoria, em uma ou duas linhas. */
  readonly blurb: string
  readonly questions: readonly ConfigQuestion[]
}

// ── vocabulário compartilhado ───────────────────────────────────────────────

const SEVERITY_OPTIONS: readonly PromptOption<string>[] = (
  ['off', 'advisory', 'blocking'] satisfies readonly ValidationSeverity[]
).map((severity) => ({
  value: severity,
  label: severity,
  hint: VALIDATION_SEVERITY_LABEL[severity],
}))

/** O que cada regra de validação detecta, para quem nunca leu o código. */
const RULE_HELP: Readonly<Record<ValidationRule, string>> = {
  scope:
    'O agente mexeu em arquivo que a task não declarou que ia tocar.\n' +
    'É o que impede uma correção pequena de virar uma reforma no projeto inteiro.',
  diffSize: 'A mudança passou do limite de arquivos ou de linhas que a task permitia.',
  forbiddenPaths:
    'A mudança tocou caminho proibido pela task (migração, CI, segredo).',
  emptyDiff: 'O agente declarou que terminou sem mudar uma linha sequer.',
  tests:
    'A suíte de testes do projeto falhou depois da mudança.\n' +
    'Projeto sem testes confiáveis: prefira "avisa" — senão toda task reprova por algo que não é culpa dela.',
  requireNewTests: 'A task pedia teste novo e nenhum arquivo de teste apareceu no diff.',
  forbidSkipped: 'Um teste foi marcado como pulado/ignorado para a suíte passar.',
  lint: 'O lint do projeto acusou erro no que foi escrito.',
  types: 'A checagem de tipos falhou depois da mudança.',
  schema: 'A resposta do modelo não veio no formato combinado (JSON fora do contrato).',
}

const VALIDATION_RULE_QUESTIONS: readonly ConfigQuestion[] = VALIDATION_RULES.map((rule) => ({
  path: `validations.rules.${rule}`,
  label: `Regra "${rule}"`,
  help: RULE_HELP[rule],
  kind: 'select' as const,
  options: SEVERITY_OPTIONS,
  ...(rule === 'tests' || rule === 'requireNewTests'
    ? {
        // Projeto sem runner detectado: exigir teste em toda task só produz
        // reprovação em série por uma ausência que o agente não causou.
        suggest: (digest: ProjectDigest | undefined): PromptAnswer | undefined =>
          digest === undefined || digest.tests.runner !== undefined
            ? undefined
            : rule === 'tests'
              ? 'advisory'
              : 'off',
      }
    : {}),
}))

/** Variável de ambiente convencional de cada provider pago. */
const API_KEY_ENV: Readonly<Record<string, string>> = {
  'openai-gpt': 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  groq: 'GROQ_API_KEY',
  gemini: 'GEMINI_API_KEY',
}

const PROVIDER_OPTIONS: readonly PromptOption<string>[] = [
  {
    value: 'claude-code',
    label: 'claude-code',
    hint: 'o app de linha de comando da Anthropic; ele mesmo edita os arquivos',
  },
  { value: 'ollama', label: 'ollama', hint: 'modelo local via Ollama, sem custo por token' },
  { value: 'lmstudio', label: 'lmstudio', hint: 'modelo local via LM Studio' },
  { value: 'local', label: 'local', hint: 'qualquer servidor compatível com a API da OpenAI' },
  { value: 'openai-gpt', label: 'openai-gpt', hint: 'API da OpenAI (paga)' },
  { value: 'openrouter', label: 'openrouter', hint: 'OpenRouter, vários modelos (paga)' },
  { value: 'groq', label: 'groq', hint: 'Groq (paga)' },
  { value: 'gemini', label: 'gemini', hint: 'Google Gemini (paga)' },
]

const QUALITY_GATE_AGENTS = ['reviewer', 'security', 'qa'] as const

interface QualityGate {
  readonly agent: string
  readonly enabled?: boolean
}

function isQualityGate(value: unknown): value is QualityGate {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { agent?: unknown }).agent === 'string'
  )
}

function asStringList(answer: PromptAnswer): readonly string[] {
  return Array.isArray(answer) ? answer.map(String) : []
}

// ── as categorias ───────────────────────────────────────────────────────────

/**
 * Todas as categorias declaradas, incluindo as que hoje não aparecem por
 * padrão. Ver `CONFIG_CATEGORIES`/`ADVANCED_CONFIG_CATEGORIES` logo abaixo do
 * array — a separação é lá, não aqui: este continua sendo o dado bruto.
 */
export const ALL_CONFIG_CATEGORIES: readonly ConfigCategory[] = [
  {
    id: 'projeto',
    title: 'Projeto',
    blurb: 'Como o projeto se chama e de que branch o trabalho parte.',
    questions: [
      {
        path: 'project.name',
        label: 'Nome do projeto',
        help: 'Aparece nos commits, nos PRs e no painel. Não muda nada no seu código.',
        kind: 'text',
      },
      {
        path: 'project.vcs.defaultBranch',
        label: 'Branch padrão',
        help:
          'De onde o Uranus parte e para onde os PRs apontam.\n' +
          'Errar aqui faz todo PR nascer comparando com uma branch que não existe.',
        kind: 'text',
        suggest: (digest) => digest?.vcs.defaultBranch,
      },
    ],
  },
  {
    id: 'modelo',
    title: 'Modelo / provider',
    blurb: 'Quem escreve o código: o Claude Code, uma API paga ou um modelo na sua máquina.',
    questions: [
      {
        path: 'providers.default',
        label: 'Quem escreve o código',
        help:
          '"claude-code" é o app da Anthropic: ele edita os arquivos por conta própria.\n' +
          'Os outros são APIs (inclusive modelos locais) em que o Uranus controla cada edição e confere a permissão a cada passo.\n' +
          'Nos pagos, a chave fica numa variável de ambiente (ex.: OPENROUTER_API_KEY) — nunca dentro do arquivo.',
        kind: 'select',
        options: PROVIDER_OPTIONS,
        writes: (answer) => {
          const id = String(answer)
          if (id === 'claude-code') {
            return [
              { path: 'providers.default', value: id },
              { path: 'providers.entries.claude-code.mode', value: 'cli' },
            ]
          }
          // Sem a entrada correspondente, `providers.default: ollama` aponta
          // para um provider que nunca é registrado — e o run morre na primeira
          // task com "nenhum provider satisfaz".
          const env = API_KEY_ENV[id]
          return [
            { path: 'providers.default', value: id },
            { path: `providers.entries.${id}.mode`, value: 'api' },
            { path: `providers.entries.${id}.preset`, value: id },
            ...(env === undefined
              ? []
              : [{ path: `providers.entries.${id}.apiKeyRef`, value: `env:${env}` }]),
          ]
        },
      },
    ],
  },
  {
    id: 'orcamento',
    title: 'Orçamento',
    blurb: 'Quanto o Uranus pode gastar. São limites duros, não estimativas.',
    questions: [
      {
        path: 'budget.perRun.usd',
        label: 'Teto de gasto por execução (US$)',
        help:
          'Vale para um run do kernel inteiro (modo avançado). Ao bater o teto o run para — nunca continua ' +
          'gastando.\nComece baixo: dá para aumentar depois de ver o custo real.',
        kind: 'number',
        min: 0,
      },
      {
        path: 'budget.perTask.usd',
        label: 'Teto de gasto por task (US$)',
        help:
          'Vale para uma task sozinha. Precisa caber o maior agente do catálogo — o especialista\n' +
          'para onde a task escala depois de falhar pede até US$ 3. Abaixo disso ele nunca é chamado.',
        kind: 'number',
        min: 0,
      },
      {
        path: 'budget.onExhausted',
        label: 'Ao esgotar o orçamento',
        help: 'O que fazer quando o teto acima é atingido no meio do trabalho.',
        kind: 'select',
        options: [
          { value: 'pause', label: 'pause', hint: 'pausa e espera você decidir (recomendado)' },
          { value: 'stop', label: 'stop', hint: 'encerra o run na hora' },
          { value: 'ask', label: 'ask', hint: 'pede aprovação para continuar' },
        ],
      },
    ],
  },
  {
    id: 'validacoes',
    title: 'Validações',
    blurb:
      'O que é conferido no trabalho pronto e o que cada falha custa. É a rede de proteção do projeto.',
    questions: [
      {
        path: 'validations.enabled',
        label: 'Conferir o trabalho antes de aceitar?',
        help:
          'Desligar aqui desliga TODAS as regras abaixo de uma vez.\n' +
          'Só faz sentido para experimentar; num projeto de verdade é o que impede código não verificado de entrar.',
        kind: 'confirm',
      },
      ...VALIDATION_RULE_QUESTIONS,
      {
        path: 'validations.maxRepairAttempts',
        label: 'Tentativas de conserto por task',
        help:
          'Quando uma regra reprova, o Uranus manda consertar apontando o problema.\n' +
          'Esgotado o número, a falha passa a contar como tentativa de verdade e a task caminha para bloqueada.',
        kind: 'number',
        min: 0,
        max: 10,
      },
    ],
  },
  {
    id: 'backlog',
    title: 'Backlog',
    blurb: 'Se o Uranus transforma sozinho os itens do backlog em tasks.',
    questions: [
      {
        path: 'backlog.autoPlan',
        label: 'Planejar os itens do backlog sozinho?',
        help:
          'Ligado, um run do kernel (modo avançado) pega itens abertos e os transforma em tasks sozinho.\n' +
          'Desligado, nada entra na fila sem você pedir. No dia a dia (`uranus chat`) isto não se aplica — ' +
          'quem decide o que fazer é o Claude, lendo o backlog direto.',
        kind: 'confirm',
      },
      {
        path: 'backlog.maxPlanningFailures',
        label: 'Recusas de plano antes de desistir de um item',
        help:
          'Um item que o Uranus nunca consegue planejar prenderia a fila e gastaria dinheiro a cada tentativa.\n' +
          'Ao chegar neste número o item sai do planejamento automático e espera você reescrevê-lo.',
        kind: 'number',
        min: 1,
        max: 10,
      },
    ],
  },
  {
    id: 'integracao',
    title: 'Integração',
    blurb: 'Como o trabalho pronto chega no seu repositório, e o que precisa da sua aprovação.',
    questions: [
      {
        path: 'integration.strategy',
        label: 'Como entregar o trabalho pronto',
        help: 'Onde o código aparece quando uma task termina e passa nas verificações.',
        kind: 'select',
        options: [
          {
            value: 'pull-request',
            label: 'pull-request',
            hint: 'abre um PR para você revisar (recomendado)',
          },
          {
            value: 'branch-only',
            label: 'branch-only',
            hint: 'comita numa branch e para por aí; o PR é com você',
          },
          {
            value: 'direct',
            label: 'direct',
            hint: 'comita direto na branch padrão — sem rede de proteção',
          },
        ],
      },
      {
        path: 'integration.draftPullRequests',
        label: 'Abrir os PRs como rascunho?',
        help:
          'Rascunho não dispara pedido de revisão para o time nem notifica ninguém.\n' +
          'É o modo educado enquanto você ainda está calibrando o Uranus.',
        kind: 'confirm',
      },
      {
        path: 'integration.requireHumanApproval',
        label: 'O que precisa da sua aprovação',
        help:
          'O Uranus para e espera você antes de fazer qualquer uma destas coisas.\n' +
          'Tirar itens daqui aumenta a autonomia e o risco na mesma medida.',
        kind: 'multiselect',
        options: [
          { value: 'merge', label: 'merge', hint: 'juntar o PR na branch padrão' },
          { value: 'command', label: 'command', hint: 'rodar comando fora da lista permitida' },
          { value: 'dependency', label: 'dependency', hint: 'adicionar ou atualizar dependência' },
          { value: 'migration', label: 'migration', hint: 'mexer em migração de banco' },
          { value: 'ci-change', label: 'ci-change', hint: 'mexer na configuração de CI' },
          { value: 'budget', label: 'budget', hint: 'passar do orçamento' },
          { value: 'force-push', label: 'force-push', hint: 'reescrever o histórico do git' },
          { value: 'secret-access', label: 'secret-access', hint: 'acessar um segredo' },
          { value: 'custom', label: 'custom', hint: 'casos marcados pelo projeto' },
        ],
      },
    ],
  },
  {
    id: 'qualidade',
    title: 'Qualidade',
    blurb: 'Quem revisa o que foi escrito antes de virar PR, e o que barra a entrega.',
    questions: [
      {
        path: 'quality.enabled',
        label: 'Revisar o trabalho com agentes de qualidade?',
        help:
          'Cada revisão custa tokens, mas é o que pega problema que teste nenhum pega.\n' +
          'Desligado, o trabalho verificado vai direto para a integração.',
        kind: 'confirm',
      },
      {
        path: 'quality.gates',
        label: 'Quais revisões rodar',
        help:
          'Rodam nesta ordem e param na primeira que bloqueia — a mais barata vem primeiro.\n' +
          'Revisões que você adicionou à mão e não estão nesta lista continuam como estão.',
        kind: 'multiselect',
        options: [
          { value: 'reviewer', label: 'reviewer', hint: 'corretude, legibilidade e dívida técnica' },
          { value: 'security', label: 'security', hint: 'segredo vazado, injeção, permissão frouxa' },
          { value: 'qa', label: 'qa', hint: 'cobra teste para o que mudou' },
        ],
        decode: (stored) =>
          Array.isArray(stored)
            ? stored
                .filter(isQualityGate)
                .filter((gate) => gate.enabled !== false)
                .map((gate) => gate.agent)
            : undefined,
        writes: (answer, current) => {
          const escolhidos = new Set(asStringList(answer))
          const existentes = Array.isArray(current) ? current.filter(isQualityGate) : []
          // Gate que o projeto declarou à mão e não está nas opções fica
          // intocado: o wizard não apaga o que não sabe explicar.
          const extras = existentes.filter(
            (gate) => !(QUALITY_GATE_AGENTS as readonly string[]).includes(gate.agent),
          )
          return [
            {
              path: 'quality.gates',
              value: [
                ...QUALITY_GATE_AGENTS.map((agent) => ({
                  agent,
                  enabled: escolhidos.has(agent),
                })),
                ...extras,
              ],
            },
          ]
        },
      },
      {
        path: 'quality.blockAt',
        label: 'Gravidade que barra a entrega',
        help:
          'Achado nesta gravidade ou acima impede o PR de sair; abaixo dela, só informa.\n' +
          'Baixar demais transforma opinião de revisor em trabalho automático.',
        kind: 'select',
        options: [
          { value: 'critical', label: 'critical', hint: 'só o que é grave de verdade' },
          { value: 'high', label: 'high', hint: 'padrão do Uranus' },
          { value: 'medium', label: 'medium', hint: 'rigoroso' },
          { value: 'low', label: 'low', hint: 'muito rigoroso' },
          { value: 'info', label: 'info', hint: 'qualquer observação barra — raramente é o que se quer' },
          { value: 'never', label: 'never', hint: 'advisory: nunca barra, só informa (perfil enxuto)' },
        ],
      },
    ],
  },
  {
    id: 'painel',
    title: 'Painel',
    blurb: 'O painel web (`uranus dashboard`): backlog, memória, git e chat em tempo real.',
    questions: [
      {
        path: 'telemetry.dashboard.port',
        label: 'Porta do painel',
        help: 'Troque se a 4319 já estiver ocupada por outro programa.',
        kind: 'number',
        min: 0,
        max: 65_535,
      },
    ],
  },
]

/**
 * Categorias que o `uranus init`/`uranus config` pergunta e que `/api/config`
 * do painel expõe por padrão.
 *
 * Desde o pivot "Uranus é armadura, não executor" (ver `docs/00-ARCHITECTURE`),
 * o Kernel não roda tasks sozinho por padrão — quem decide e age é o Claude,
 * via `uranus chat`. Calibrar orçamento, validações de código, planejamento
 * automático de backlog, estratégia de integração e gates de qualidade é
 * afinar um motor que não está ligado; perguntar isso a quem só vai usar
 * `uranus chat` confunde mais do que ajuda. Ficam de fora por padrão — não
 * apagadas: continuam inteiras em `ALL_CONFIG_CATEGORIES`/
 * `ADVANCED_CONFIG_CATEGORIES` para quando o modo Kernel voltar a ser exposto.
 */
const DEFAULT_CATEGORY_IDS = new Set(['projeto', 'painel'])

export const CONFIG_CATEGORIES: readonly ConfigCategory[] = ALL_CONFIG_CATEGORIES.filter((c) =>
  DEFAULT_CATEGORY_IDS.has(c.id),
)

/** O resto: modelo/provider, orçamento, validações, backlog, integração, qualidade. */
export const ADVANCED_CONFIG_CATEGORIES: readonly ConfigCategory[] = ALL_CONFIG_CATEGORIES.filter(
  (c) => !DEFAULT_CATEGORY_IDS.has(c.id),
)

// ── perguntar e apurar (puro onde dá) ───────────────────────────────────────

/**
 * A configuração como o Uranus de fato a aplica.
 *
 * `validations.rules` é parcial no arquivo e completada pelo core em tempo de
 * execução (`resolveValidationPolicy`), fora do schema. Sem isto o wizard
 * mostraria "—" para uma regra que na prática reprova a verificação, e gravaria
 * as dez de volta no arquivo quando o humano só apertasse Enter.
 */
export function resolvedConfig(config: UranusConfig): UranusConfig {
  return {
    ...config,
    validations: {
      ...config.validations,
      rules: resolveValidationPolicy(config.validations).rules,
    },
  }
}

/**
 * O que a pergunta mostra como padrão.
 *
 * O valor de hoje quase sempre — mas a sugestão da detecção passa na frente do
 * **default do schema**, e só dele. Sem esse critério a sugestão seria letra
 * morta: quase todo campo tem default, então "não tem valor ainda" nunca
 * aconteceria. `origins` é o que distingue "o dono escreveu isto" de "ninguém
 * escolheu, é o default" — e o que o dono escreveu o wizard não contradiz.
 */
export function currentAnswer(
  question: ConfigQuestion,
  effective: UranusConfig,
  digest?: ProjectDigest,
  origins?: ReadonlyMap<string, ConfigOrigin>,
): PromptAnswer | undefined {
  const stored = valueAtPath(effective, pathSegments(question.path))
  // Sem o mapa de procedência não dá para saber se o valor veio do arquivo; o
  // conservador é assumir que veio, e não sobrescrever escolha do humano.
  const declarado = origins === undefined ? stored !== undefined : origins.has(question.path)
  if (!declarado) {
    const sugerido = question.suggest?.(digest)
    if (sugerido !== undefined) return sugerido
  }
  if (stored === undefined) return undefined
  if (question.decode !== undefined) return question.decode(stored)
  if (typeof stored === 'string' || typeof stored === 'number' || typeof stored === 'boolean') {
    return stored
  }
  return Array.isArray(stored) ? stored.map(String) : undefined
}

export function writesFor(
  question: ConfigQuestion,
  answer: PromptAnswer,
  current: unknown,
): readonly ConfigWrite[] {
  return question.writes === undefined
    ? [{ path: question.path, value: answer }]
    : question.writes(answer, current)
}

export interface ConfigChange {
  readonly path: string
  readonly from: unknown
  readonly to: unknown
}

/** Só o que de fato muda — confirmar uma lista de "nada mudou" educa a ignorá-la. */
export function pendingChanges(
  effective: UranusConfig,
  writes: readonly ConfigWrite[],
): readonly ConfigChange[] {
  const mudancas: ConfigChange[] = []
  for (const write of writes) {
    const atual = valueAtPath(effective, pathSegments(write.path))
    if (sameValue(atual, write.value)) continue
    mudancas.push({ path: write.path, from: atual, to: write.value })
  }
  return mudancas
}

export function renderChangeSummary(changes: readonly ConfigChange[]): readonly string[] {
  if (changes.length === 0) return []
  const width = Math.max(...changes.map((change) => change.path.length))
  return changes.map(
    (change) =>
      `  ${change.path.padEnd(width)}  ${formatConfigValue(change.from)} → ${formatConfigValue(change.to)}`,
  )
}

export function askQuestion(
  io: PromptIo,
  question: ConfigQuestion,
  current: PromptAnswer | undefined,
): Promise<PromptAnswer> {
  const { label, help } = question
  switch (question.kind) {
    case 'text':
      return ask(io, label, {
        help,
        ...(current === undefined ? {} : { default: String(current) }),
      })
    case 'number':
      return askNumber(io, label, {
        help,
        ...(question.min === undefined ? {} : { min: question.min }),
        ...(question.max === undefined ? {} : { max: question.max }),
        ...(typeof current === 'number' ? { default: current } : {}),
      })
    case 'confirm':
      return confirm(io, label, {
        help,
        ...(typeof current === 'boolean' ? { default: current } : {}),
      })
    case 'select':
      return select(io, label, question.options ?? [], {
        help,
        ...(current === undefined ? {} : { default: String(current) }),
      })
    case 'multiselect':
      return multiselect(io, label, question.options ?? [], {
        help,
        ...(Array.isArray(current) ? { defaults: current.map(String) } : {}),
      })
  }
}

/** Uma passada por todas as perguntas da categoria; devolve o que gravar. */
export async function runCategory(
  io: PromptIo,
  category: ConfigCategory,
  effective: UranusConfig,
  digest?: ProjectDigest,
  origins?: ReadonlyMap<string, ConfigOrigin>,
): Promise<readonly ConfigWrite[]> {
  io.write(`\n── ${category.title} ${'─'.repeat(Math.max(0, 60 - category.title.length))}\n`)
  io.write(`${category.blurb}\n`)
  const writes: ConfigWrite[] = []
  for (const question of category.questions) {
    const current = currentAnswer(question, effective, digest, origins)
    const answer = await askQuestion(io, question, current)
    writes.push(
      ...writesFor(question, answer, valueAtPath(effective, pathSegments(question.path))),
    )
  }
  return writes
}

// ── `uranus config show` ────────────────────────────────────────────────────

const ORIGIN_LABEL: Readonly<Record<string, string>> = {
  project: 'arquivo do projeto',
  global: '~/.uranus/config.yaml',
  env: 'variável URANUS_*',
  flags: 'flag de linha de comando',
}

export interface ConfigOrigin {
  readonly layer: string
  readonly source: string
}

/**
 * Configuração efetiva por categoria, dizendo o que veio do arquivo e o que é
 * default. Mesmo formato visual do `uranus validations`: tabela alinhada,
 * legenda embaixo, e a última linha diz como mudar.
 */
export function renderConfigShow(
  effective: UranusConfig,
  origins: ReadonlyMap<string, ConfigOrigin>,
  configPath: string,
): readonly string[] {
  const resolvida = resolvedConfig(effective)
  const linhas: string[] = [`Configuração efetiva — ${configPath}`]
  for (const category of CONFIG_CATEGORIES) {
    linhas.push('')
    linhas.push(category.title)
    linhas.push(`  ${category.blurb}`)
    for (const question of category.questions) {
      // O mesmo valor que o wizard mostraria — inclusive traduzido, como a
      // lista de gates ligados. Duas telas, uma resposta.
      const valor = currentAnswer(question, resolvida, undefined, origins)
      const origem = origins.get(question.path)
      const procedencia =
        origem === undefined ? 'default do Uranus' : (ORIGIN_LABEL[origem.layer] ?? origem.layer)
      linhas.push(
        `  ${question.path.padEnd(34)} ${formatConfigValue(valor).padEnd(26)} ${procedencia}`,
      )
    }
  }
  linhas.push('')
  linhas.push('Para mudar: `uranus config` (guiado) ou `uranus config set <caminho> <valor>`.')
  return linhas
}

// ── a sessão guiada ─────────────────────────────────────────────────────────

export interface WizardSession {
  readonly io: PromptIo
  readonly configPath: string
  /** Conteúdo atual do YAML — os comentários dele precisam sobreviver. */
  readonly source: string
  /** Camadas do `loadConfig`: a validação acontece no merge, como no carregamento real. */
  readonly layers: readonly ConfigLayer[]
  readonly effective: UranusConfig
  /** Procedência de cada caminho (`loadConfig`): separa escolha do dono de default. */
  readonly origins?: ReadonlyMap<string, ConfigOrigin>
  readonly digest?: ProjectDigest
  readonly save: (text: string) => Promise<void>
}

const SAIR = '__sair__'

export function renderCategoryOptions(): readonly PromptOption<string>[] {
  return [
    ...CONFIG_CATEGORIES.map((category) => ({
      value: category.id,
      label: category.title,
      hint: category.blurb.split('\n')[0] ?? '',
    })),
    { value: SAIR, label: 'sair', hint: 'encerra; o que já foi gravado continua gravado' },
  ]
}

/**
 * O laço do `uranus config`: escolhe categoria, responde, vê o que muda,
 * confirma, grava, volta ao menu.
 *
 * A gravação acontece num **clone** do documento e só substitui o original
 * depois de validar. Assim uma resposta que produziria config inválida custa
 * uma mensagem de erro, não o arquivo do projeto.
 */
export async function runConfigWizard(session: WizardSession): Promise<number> {
  const { io } = session
  let doc: Document = parseDocument(session.source)
  let effective = resolvedConfig(session.effective)
  const origens = new Map(session.origins ?? [])
  let gravacoes = 0

  for (;;) {
    const escolha = await select(io, 'O que você quer configurar?', renderCategoryOptions(), {
      default: SAIR,
      help: 'Responda o número. Cada categoria é um bloco de perguntas independente.',
    })
    if (escolha === SAIR) return gravacoes
    const categoria = CONFIG_CATEGORIES.find((item) => item.id === escolha)
    if (categoria === undefined) return gravacoes

    const writes = await runCategory(io, categoria, effective, session.digest, origens)
    const mudancas = pendingChanges(effective, writes)
    if (mudancas.length === 0) {
      io.write('\nNada mudou nesta categoria.\n')
      continue
    }

    io.write('\nO que vai mudar:\n')
    for (const linha of renderChangeSummary(mudancas)) io.write(`${linha}\n`)
    if (!(await confirm(io, `Gravar em ${session.configPath}?`, { default: true }))) {
      io.write('Nada foi gravado.\n')
      continue
    }

    // Só o que mudou vai para o arquivo: gravar também as respostas que
    // repetem o default encheria o YAML de valores que o usuário não escolheu
    // — e congelaria defaults que deveriam continuar acompanhando o Uranus.
    const candidato = cloneDocument(doc)
    applyWrites(
      candidato,
      effective,
      mudancas.map((mudanca) => ({ path: mudanca.path, value: mudanca.to })),
    )
    const validado = validateProjectData(documentToData(candidato), session.layers)
    if (!validado.ok) {
      // Nunca gravar um YAML que não carrega: o schema aborta a inicialização
      // do Uranus, então o arquivo quebrado só seria descoberto no comando
      // seguinte — e aí nem `uranus config` abriria mais para consertá-lo.
      io.write(`\n${validado.error.message}\n`)
      io.write('Nada foi gravado — a configuração continua como estava.\n')
      continue
    }

    await session.save(candidato.toString())
    doc = candidato
    effective = resolvedConfig(validado.value)
    // O que acabou de ser gravado passa a ser escolha do dono: uma sugestão da
    // detecção não pode reaparecer por cima dela na volta ao menu.
    for (const mudanca of mudancas) {
      origens.set(mudanca.path, { layer: 'project', source: session.configPath })
    }
    gravacoes += 1
    io.write(`\nGravado em ${session.configPath}.\n`)
  }
}
