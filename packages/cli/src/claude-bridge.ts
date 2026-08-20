import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProjectDigest } from '@uranus/core'

/**
 * Ponte com o Claude Code nativo (`.claude/`).
 *
 * Uranus deixou de ser o único dono do controle de fluxo (INV-1 continua
 * valendo dentro do Kernel, mas o modo `uranus chat` entrega a orquestração
 * pro próprio Claude Code, via os subagentes nativos dele). Este módulo gera
 * o que o Claude Code lê sozinho ao abrir uma sessão no projeto:
 * `CLAUDE.md`, `.claude/agents/*.md` e os hooks de observabilidade em
 * `.claude/settings.json` — para que a orquestração já chegue "treinada",
 * sem o usuário escrever prompt nenhum.
 *
 * Regra de convivência com o que já existe no projeto (a pergunta que gerou
 * este arquivo): NUNCA apagar conteúdo do usuário.
 *   - `CLAUDE.md`: o que o Uranus escreve fica entre marcadores. Tudo FORA
 *     deles é do usuário e nunca é tocado; o que está DENTRO é regenerado a
 *     cada `init`/`attach` — é por isso que o marcador avisa para não editar
 *     o miolo.
 *   - `agents/*.md`: só arquivos com o prefixo `uranus-` são gerados/
 *     sobrescritos. Um agente que o usuário escreveu à mão (`meu-agente.md`)
 *     nunca é tocado, porque nunca casa com o prefixo.
 *   - `settings.json`: merge raso em `hooks.*`, removendo só as entradas que
 *     o próprio Uranus registrou antes (reconhecidas pelo marcador no
 *     comando) e preservando qualquer hook que o usuário tenha configurado.
 */

export const MANAGED_BEGIN = '<!-- URANUS:BEGIN'
export const MANAGED_END = '<!-- URANUS:END -->'
const MANAGED_VERSION = 1
const AGENT_FILE_PREFIX = 'uranus-'
/** Marca as entradas de hook que o Uranus é dono — ver `mergeSettingsHooks`. */
export const HOOK_MARKER = '#uranus-managed'

export interface ClaudeAgentSpec {
  readonly id: string
  readonly description: string
  readonly model: 'haiku' | 'sonnet' | 'opus'
  /** Ausente = herda todas as ferramentas da sessão (default do Claude Code). */
  readonly tools?: readonly string[]
  readonly prompt: string
}

/**
 * Catálogo de subagentes nativos do Claude Code.
 *
 * Adaptado do catálogo de 21 agentes do Uranus (`docs/00-ARCHITECTURE.md`
 * §7.2), mas consolidado: agentes que eram responsabilidade do Kernel
 * (ContextManager, MemoryManager, Scheduler) não têm equivalente aqui — o
 * Claude Code não tem orçamento de contexto nem fila para gerenciar, ele lê o
 * projeto sozinho. O que sobra é o que faz sentido como especialista
 * delegável, com separação de responsabilidade e tier de modelo deliberados:
 *
 *   - `opus`   — raciocínio caro: decompor trabalho, investigar falha difícil.
 *   - `sonnet` — implementação e julgamento do dia a dia.
 *   - `haiku`  — mecânico e barato: reconhecimento de código, docs, deps, git.
 *
 * `context-scout` é o agente que resolve "projeto grande, contexto grande"
 * sem gastar tokens caros só em exploração: qualquer especialista que precise
 * entender uma área desconhecida do repo delega a varredura pra ele primeiro
 * e recebe um resumo, em vez de o orquestrador (ou um agente `opus`) ler
 * dezenas de arquivos por conta própria.
 */
export const AGENT_CATALOG: readonly ClaudeAgentSpec[] = Object.freeze([
  {
    id: 'planner',
    model: 'opus',
    description:
      'Quebra um item de backlog ou um pedido em subtasks pequenas e concretas, decide quais agentes especialistas ' +
      'chamar e em que ordem, e identifica o que pode rodar em paralelo. Use SEMPRE antes de começar um item de ' +
      'backlog não-trivial, ou quando o pedido do usuário tocar mais de uma área do projeto.',
    prompt:
      'Você é o planejador. Sua função é decompor, não implementar.\n\n' +
      '1. Leia o item de backlog ou o pedido por inteiro antes de quebrar em partes.\n' +
      '2. Produza uma lista curta de subtasks, cada uma pequena o bastante para um único agente especialista ' +
      'terminar sem precisar replanejar no meio.\n' +
      '3. Para cada subtask, diga: qual agente (do catálogo do projeto) deve executá-la, e se ela pode rodar em ' +
      'paralelo com outras (arquivos/áreas diferentes) ou precisa esperar uma dependência terminar primeiro.\n' +
      '4. Prefira o agente mais barato capaz de fazer o trabalho — não escale para opus/sonnet o que um agente ' +
      'haiku resolve.\n' +
      '5. Nunca implemente você mesmo: devolva o plano para o orquestrador despachar.',
  },
  {
    id: 'context-scout',
    model: 'haiku',
    tools: ['Read', 'Glob', 'Grep', 'Bash'],
    description:
      'Reconhecimento rápido e barato de uma área do código antes de um especialista trabalhar nela: onde as ' +
      'coisas estão, como se conectam, quais convenções já existem. Somente leitura. Use antes de tarefas em ' +
      'áreas grandes ou pouco familiares do projeto, para não gastar um agente caro só explorando.',
    prompt:
      'Você mapeia código, nunca muda código.\n\n' +
      '0. Se `graphify-out/graph.json` existir na raiz do projeto, comece por `graphify query "<pergunta de ' +
      'reconhecimento>"` — é mais barato que ler arquivo por arquivo e já aponta os nós certos. Só caia para ' +
      'Read/Glob/Grep quando o grafo não existir, estiver claramente desatualizado, ou a resposta do `query` não ' +
      'cobrir o que foi pedido.\n' +
      '1. Responda exatamente à pergunta de reconhecimento recebida — não vá além do escopo pedido.\n' +
      '2. Devolva um resumo objetivo: arquivos relevantes (caminho + por quê), padrões e convenções observados, ' +
      'e qualquer coisa que pareça armadilha (acoplamento, duplicação, código morto na área).\n' +
      '3. Sem opinião de implementação — isso é trabalho do especialista que vai receber seu resumo.',
  },
  {
    id: 'backend',
    model: 'sonnet',
    description:
      'Implementa mudanças server-side: APIs, regras de negócio, integrações, jobs. Use para qualquer subtask ' +
      'de backend que o planner tenha delegado.',
    prompt:
      'Implemente exatamente o que a subtask pede, dentro do escopo declarado — nada de refatoração oportunista ' +
      'fora do pedido. Siga as convenções já existentes no projeto (nomeação, estrutura de erro, camadas) em vez ' +
      'de introduzir um padrão novo. Se o escopo da subtask esbarrar em algo que precisa de decisão maior, pare e ' +
      'reporte em vez de decidir sozinho.',
  },
  {
    id: 'frontend',
    model: 'sonnet',
    description:
      'Implementa mudanças client-side: telas, componentes, estado de UI, chamadas à API. Use para qualquer ' +
      'subtask de frontend que o planner tenha delegado.',
    prompt:
      'Implemente exatamente o que a subtask pede. Reaproveite componentes e padrões visuais já existentes no ' +
      'projeto em vez de criar um estilo paralelo. Depois de mudar algo visível, valide de verdade com o ' +
      '`agent-browser` (ver seção "Testar UI no navegador" do projeto) em vez de só descrever os passos — abra a ' +
      'tela, interaja com o fluxo que mudou, tire um screenshot. Só descreva os passos manuais se `agent-browser` ' +
      'genuinamente não se aplicar (ex.: app não roda num navegador).',
  },
  {
    id: 'database',
    model: 'sonnet',
    description:
      'Migrations, modelagem de schema, integridade de dados. Use para qualquer subtask que toque banco de dados.',
    prompt:
      'Toda migration precisa ser reversível ou ter o motivo documentado de por que não é. Nunca uma migration ' +
      'destrutiva (drop, truncate, coluna NOT NULL sem default em tabela com dado) sem avisar explicitamente no ' +
      'resumo final — essa é uma decisão que o humano precisa ver antes de aceitar.',
  },
  {
    id: 'refactor',
    model: 'sonnet',
    description:
      'Reduz dívida técnica sem alterar comportamento observável. Use quando a subtask for explicitamente sobre ' +
      'limpar/reorganizar código já funcionando, não sobre adicionar funcionalidade.',
    prompt:
      'Comportamento observável não muda — se mudar, não é refactor, é outra coisa, e a subtask deve ser recusada ' +
      'de volta ao orquestrador com essa explicação. Prefira mudanças pequenas e revisáveis a uma reescrita ' +
      'grande: cada uma devia dar para revisar sozinha num PR.',
  },
  {
    id: 'bug-hunter',
    model: 'opus',
    description:
      'Investiga e isola falhas difíceis: comportamento intermitente, stack trace sem causa óbvia, algo que outro ' +
      'agente tentou corrigir e não resolveu. Use na escalada, não como primeira tentativa.',
    prompt:
      'Reproduza antes de corrigir. Se não conseguir reproduzir de forma confiável, diga isso explicitamente em ' +
      'vez de aplicar uma correção especulativa. Uma vez isolada a causa raiz, a correção deve ser o menor diff ' +
      'possível que resolve exatamente essa causa — não uma reescrita da área ao redor.',
  },
  {
    id: 'reviewer',
    model: 'sonnet',
    tools: ['Read', 'Glob', 'Grep', 'Bash'],
    description:
      'Revisão de código somente-leitura: corretude, legibilidade, aderência às convenções do projeto, e ' +
      'principalmente bugs que os testes não cobrem. Use depois de qualquer subtask de implementação, antes de ' +
      'considerá-la pronta — mesmo que a validação automática já tenha passado.',
    prompt:
      'Você não edita código, só relata achados. Seja proativo em achar bug, não só em apontar estilo: procure ' +
      'especificamente por edge case não tratado, condição de corrida, erro engolido silenciosamente, e ' +
      'comportamento que diverge do que o texto da task pedia. Para cada achado, diga severidade, arquivo/linha e ' +
      'uma sugestão concreta. Achados de estilo puro (nome de variável, formatação) só valem menção rápida — não ' +
      'viram o foco da revisão.',
  },
  {
    id: 'security',
    model: 'sonnet',
    tools: ['Read', 'Glob', 'Grep', 'Bash'],
    description:
      'Segurança: segredo exposto, injeção, permissão frouxa, dependência vulnerável, validação de entrada ' +
      'ausente. Use depois de qualquer subtask que toque autenticação, dados de usuário, execução de comando, ' +
      'ou entrada externa.',
    prompt:
      'Foque no que é explorável de verdade, não em teoria. Para cada achado, explique o cenário de exploração em ' +
      'uma frase (quem, como, o que consegue) — um achado sem cenário concreto normalmente não é achado. Segredo ' +
      'em código nunca é "baixa severidade", mesmo que pareça de teste.',
  },
  {
    id: 'docs',
    model: 'haiku',
    description:
      'Mantém README e docs sincronizados com o código que mudou. Use depois de uma mudança que altera comando, ' +
      'configuração ou comportamento documentado — não para todo PR.',
    prompt:
      'Atualize só o que ficou desatualizado pela mudança em questão. Não reescreva documentação que já estava ' +
      'correta, e não adicione documentação nova para código que não pediu.',
  },
  {
    id: 'deps',
    model: 'haiku',
    tools: ['Read', 'Edit', 'Bash', 'Grep', 'Glob'],
    description:
      'Atualiza dependências e avalia breaking changes do changelog. Use quando a subtask for explicitamente ' +
      'sobre dependências, não como parte de outra subtask.',
    prompt:
      'Leia o changelog/release notes de qualquer bump maior antes de aplicar. Se houver breaking change que toca ' +
      'código do projeto, diga isso explicitamente em vez de aplicar o bump calado.',
  },
  {
    id: 'git-release',
    model: 'haiku',
    tools: ['Read', 'Bash', 'Grep', 'Glob'],
    description:
      'Higiene de git: mensagem de commit, descrição de PR, entrada de changelog. Use ao final de uma subtask ' +
      'significativa concluída, para preparar a entrega — nunca decide sozinho se algo está pronto.',
    prompt:
      'Mensagem de commit e descrição de PR focam no "porquê", não relistam o diff. Nunca faça push --force, ' +
      'nunca mexa na branch default diretamente, nunca abra PR sem que a subtask correspondente esteja de fato ' +
      'concluída.',
  },
])

export function agentFileName(id: string): string {
  return `${AGENT_FILE_PREFIX}${id}.md`
}

export function isUranusAgentFile(fileName: string): boolean {
  return fileName.startsWith(AGENT_FILE_PREFIX) && fileName.endsWith('.md')
}

export function renderAgentFile(spec: ClaudeAgentSpec): string {
  const lines = [
    '---',
    `name: ${spec.id}`,
    `description: ${yamlString(spec.description)}`,
    ...(spec.tools === undefined ? [] : [`tools: ${spec.tools.join(', ')}`]),
    `model: ${spec.model}`,
    '---',
    '',
    spec.prompt.trim(),
    '',
  ]
  return lines.join('\n')
}

/** YAML flow scalar simples — as descrições não têm dois-pontos nem quebra de linha. */
function yamlString(text: string): string {
  return text.includes(': ') || text.includes('#') ? JSON.stringify(text) : text
}

/** Estrutural: `InstructionNote` de `instructions.ts` se encaixa como está. */
export interface ClaudeMdInstruction {
  readonly title: string
  readonly body: string
  /** Pasta a que a instrução se aplica. Ausente = projeto inteiro. */
  readonly scope?: string
}

export interface ClaudeMdInput {
  readonly projectName: string
  readonly digest?: ProjectDigest
  readonly dashboardUrl?: string
  /**
   * Instruções que valem para ESTE `CLAUDE.md`. `writeClaudeConfig` já filtrou
   * por escopo antes de chamar — aqui é só o que entra na seção "Instruções
   * do projeto", sem regra de escopo nenhuma.
   */
  readonly instructions?: readonly ClaudeMdInstruction[]
}

/** Corpo gerenciado do `CLAUDE.md` — sem os marcadores, `mergeManagedBlock` cuida disso. */
export function renderClaudeMdBody(input: ClaudeMdInput): string {
  const stack =
    input.digest === undefined || input.digest.languages.length === 0
      ? undefined
      : input.digest.languages
          .slice(0, 4)
          .map((l) => `${l.name} (${String(Math.round(l.share * 100))}%)`)
          .join(', ')
  const frameworks = input.digest?.frameworks.join(', ')
  const testCmd = input.digest?.tests.command

  const catalogTable = AGENT_CATALOG.map(
    (a) => `| \`${a.id}\` | ${a.model} | ${firstSentence(a.description)} |`,
  ).join('\n')

  return [
    `# ${input.projectName} — orquestrado pelo Uranus`,
    '',
    'Este projeto usa o Uranus (`uranus chat`) como orquestrador. Você é a sessão mestre: quando o trabalho não ' +
      'é trivial, planeje com o agente `planner` e despache subtasks para os especialistas do catálogo abaixo em ' +
      'vez de fazer tudo você mesmo numa sessão só — isso é o que dá paralelismo real e evita que uma sessão só ' +
      'fique tentando entender um projeto inteiro de uma vez.',
    '',
    '## Backlog',
    '',
    'Os itens ficam em `.uranus/backlog/*.yaml` (um arquivo por item; `uranus backlog list` mostra o resumo). ' +
      'Quando o usuário pedir para trabalhar no backlog: leia os itens pendentes, chame `planner` para quebrar ' +
      'cada um em subtasks, e despache. Convenções e decisões já registradas ficam em `.uranus/memory/` — leia ' +
      'antes de assumir um padrão nas implementações. Use `uranus backlog status <id> <estado>` ' +
      '(open|planned|done|dropped) para fechar, descartar ou reabrir um item você mesmo — por exemplo quando o ' +
      'usuário decide abandonar um item em conversa, ou quando um item já foi resolvido.',
    '',
    '## Memória',
    '',
    'Além de ler `.uranus/memory/`, grave o que você aprender de relevante para o futuro com ' +
      '`uranus memory add "título" --scope <escopo> --body "..."` — escopos: architecture, decision, bug, ' +
      'preference, stack, pattern, convention, roadmap, history, context. Vale a pena registrar: uma decisão de ' +
      'arquitetura e o porquê, uma preferência do usuário sobre como trabalhar, um bug recorrente e a causa raiz, ' +
      'uma convenção do projeto que não está óbvia no código. Use `[[título de outra nota]]` no corpo para linkar ' +
      'memória, backlog e instruções entre si — `uranus vault` mostra o grafo resultante, e é o que te dá contexto ' +
      'mais rico na próxima sessão em vez de reconstruir tudo do zero a cada vez.',
    '',
    '**Antes de escrever `[[wikilink]]`**: o texto dentro dos colchetes precisa ser o TÍTULO exato de uma nota ' +
      'que já existe (memória, item de backlog ou instrução) — comparação sem diferenciar maiúsculas, mas nada ' +
      'além disso. Não é a chave/slug interna (`uranus memory add` gera uma chave tipo `algo-como-isto`; o ' +
      'wikilink não resolve contra ela) nem um resumo do que você quis dizer — é o título, palavra por palavra. ' +
      'Depois de gravar memória/backlog/instrução com `[[links]]`, rode `uranus vault` e confira a linha "Links ' +
      'ainda sem nota correspondente" no final: se o link que você acabou de escrever aparecer ali, ou (a) o ' +
      'título tem um erro de digitação/formatação — corrija pra bater com a nota real, ou (b) o conceito ' +
      'referenciado ainda não tem nota — crie uma pra ele, ou (c) não vale a pena virar nota — troque o ' +
      '`[[wikilink]]` por texto normal. Nunca deixe um link apontando pro vazio de propósito.',
    '',
    '## Grafo de contexto (graphify)',
    '',
    'Se `graphify-out/graph.json` já existe neste projeto, prefira `graphify query "<pergunta>"` a reler arquivos ' +
      'um por um para entender uma área — é mais barato e já aponta os nós certos (`context-scout` faz isso por ' +
      'padrão). Se ainda não existe e a tarefa exige entender uma área grande ou pouco familiar do projeto, rode a ' +
      'skill `/graphify` uma vez antes de explorar manualmente; `/graphify path` e `/graphify explain` servem para ' +
      'perguntas mais específicas (caminho entre dois conceitos, o que um nó faz). O painel (`uranus dashboard` → ' +
      'aba Grafo) mostra o mesmo grafo, com comunidades e god nodes — é um snapshot de quando a skill rodou por ' +
      'último, então atualize com `/graphify --update` quando o código tiver mudado bastante desde a última vez.',
    '',
    '## Catálogo de agentes',
    '',
    '| agente | modelo | quando usar |',
    '| --- | --- | --- |',
    catalogTable,
    '',
    'Regras de despacho:',
    '',
    '- Tarefas sem dependência de arquivo/área entre si: despache em paralelo (múltiplas chamadas do Task tool na ' +
      'mesma resposta), não em série.',
    '- Use o agente mais barato capaz do trabalho — não chame `opus` para o que `haiku` resolve (docs, deps, git).',
    '- Depois de qualquer implementação, rode `reviewer` (e `security` se tocou autenticação/dados/entrada ' +
      'externa) antes de considerar a subtask pronta — mesmo que a validação automática já tenha passado.',
    '- Para área do código pouco familiar ou projeto grande, mande o `context-scout` reconhecer primeiro em vez ' +
      'de gastar um agente caro só explorando.',
    '',
    '## Testar UI no navegador (agent-browser)',
    '',
    'Ao codar ou mudar qualquer aplicação web, valide de verdade abrindo no navegador — ler o código de volta não ' +
      'é validação. Use o `agent-browser` (github.com/vercel-labs/agent-browser): CLI feito pra agente, sem ' +
      'Playwright/Puppeteer, que lê a página como árvore de acessibilidade (refs `@e1`, `@e2`...) em vez de HTML ' +
      'cru — mais barato em tokens e mais estável que seletor CSS.',
    '',
    'Se `agent-browser --version` falhar (não instalado nesta máquina), instale antes de usar: `npm install -g ' +
      'agent-browser && agent-browser install` (a segunda etapa baixa o Chrome for Testing, só na primeira vez).',
    '',
    'Fluxo básico:',
    '',
    '```',
    'export AGENT_BROWSER_SESSION="$(agent-browser session id --scope worktree --prefix task)"',
    '# sessão própria — a sessão default é COMPARTILHADA com qualquer outro agente na máquina; sem isto dois',
    '# agentes em paralelo pisam na aba um do outro.',
    'agent-browser open <url>',
    'agent-browser snapshot -i         # elementos interativos, com refs',
    'agent-browser click @e1           # ou fill/hover/select — sempre por ref, nunca adivinhando seletor CSS',
    'agent-browser snapshot -i         # re-tira o snapshot depois de QUALQUER mudança de tela — refs ficam',
    '                                  # velhos assim que a página muda',
    'agent-browser screenshot out.png  # evidência visual de que funcionou',
    'agent-browser close',
    '```',
    '',
    'Use sempre que a subtask tocar UI: depois de implementar algo visível, ao investigar um bug relatado como ' +
      'visual, ou pra validar um fluxo antes de dar a subtask por pronta. `agent-browser --help` cobre o resto ' +
      'dos comandos (formulário, upload, cookies, storage, device emulation...).',
    '',
    '## Qualidade',
    '',
    'O Uranus não roda verificação de código própria — sem lint, sem checagem de escopo, sem gate que aprova ou ' +
      'reprova um diff. Isso é decisão do projeto, não ausência de cuidado: quem julga o trabalho é você. Rode o ' +
      'que houver de teste/lint do próprio projeto' +
      (testCmd === undefined ? '' : ` (\`${testCmd}\`)`) +
      ' antes de dar uma subtask por concluída, use `reviewer`/`security` como descrito acima, e siga as ' +
      'instruções da seção abaixo quando existirem — é a rede de proteção real deste projeto.',
    '',
    '## Entrega',
    '',
    'Ao concluir uma subtask significativa (não cada micro-edição): commit com mensagem que explica o porquê, e ' +
      'abra PR (`gh pr create`) em vez de acumular mudanças não relacionadas numa branch só. Isso deixa o humano ' +
      'revisar e integrar incrementalmente, sem esperar o backlog inteiro terminar.',
    '',
    ...(stack === undefined && frameworks === undefined && (input.dashboardUrl ?? '') === ''
      ? []
      : [
          '## Projeto',
          '',
          ...(stack === undefined ? [] : [`- Stack: ${stack}`]),
          ...(frameworks === undefined || frameworks === '' ? [] : [`- Frameworks: ${frameworks}`]),
          ...(input.dashboardUrl === undefined
            ? []
            : [`- Painel ao vivo: ${input.dashboardUrl} (\`uranus dashboard\`)`]),
          '',
        ]),
    ...renderInstructionsSection(input.instructions),
  ].join('\n')
}

/**
 * Seção "Instruções do projeto" — o que substituiu as regras de validação de
 * código. Cada nota vira um `###`; o corpo entra verbatim, porque é prosa
 * escrita por quem entende o projeto, não dado a reformatar.
 */
function renderInstructionsSection(
  instructions: readonly ClaudeMdInstruction[] | undefined,
): string[] {
  if (instructions === undefined || instructions.length === 0) return []
  const lines = [
    '## Instruções do projeto',
    '',
    'Escritas pelo dono do projeto (painel → aba Instruções ou `.uranus/instructions/*.md`). Valem tanto quanto o resto deste arquivo.',
    '',
  ]
  for (const note of instructions) {
    lines.push(`### ${note.title}`, '', note.body.trim(), '')
  }
  return lines
}

function firstSentence(text: string): string {
  const cut = text.indexOf('. ')
  return cut === -1 ? text : `${text.slice(0, cut)}.`
}

/**
 * Funde o bloco gerido pelo Uranus dentro de um `CLAUDE.md` existente.
 *
 * Sem marcador ainda → acrescenta no final, preservando 100% do que já
 * existia. Com marcador → substitui só o miolo entre eles. O que está fora
 * das marcas — de qualquer tamanho, em qualquer posição — nunca é tocado.
 */
export function mergeManagedBlock(existing: string | undefined, body: string): string {
  const begin =
    `${MANAGED_BEGIN} v${String(MANAGED_VERSION)} — gerado por \`uranus init\`/\`uranus attach\`. ` +
    'Edite à vontade FORA destas marcas; o que fica DENTRO é regenerado a cada bootstrap. -->'
  const block = `${begin}\n\n${body.trim()}\n\n${MANAGED_END}`

  const source = existing ?? ''
  const beginIdx = source.indexOf(MANAGED_BEGIN)
  const endIdx = source.indexOf(MANAGED_END)
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    const separator = source.trim() === '' ? '' : '\n\n'
    return `${source.replace(/\s*$/, '')}${separator}${block}\n`
  }
  const before = source.slice(0, beginIdx)
  const after = source.slice(endIdx + MANAGED_END.length)
  return `${before}${block}${after}`
}

export interface HookCommand {
  readonly event: 'UserPromptSubmit' | 'Stop' | 'SubagentStart' | 'SubagentStop' | 'PreToolUse' | 'PostToolUse'
  readonly matcher?: string
  readonly command: string
}

/**
 * Funde hooks no `settings.json` do projeto sem apagar o que o usuário já
 * configurou. Entradas que o Uranus mesmo escreveu antes (reconhecidas pelo
 * `HOOK_MARKER` no fim do comando) são substituídas; todo o resto do arquivo
 * — inclusive hooks de outra origem no mesmo evento — sobrevive.
 */
export function mergeSettingsJson(
  existingRaw: string | undefined,
  ours: readonly HookCommand[],
): string {
  const settings = parseJsonObject(existingRaw)
  const hooks = isRecord(settings['hooks']) ? { ...settings['hooks'] } : {}

  const byEvent = new Map<string, HookCommand[]>()
  for (const hook of ours) {
    const list = byEvent.get(hook.event) ?? []
    list.push(hook)
    byEvent.set(hook.event, list)
  }

  for (const [event, entries] of byEvent) {
    const existingEntries = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : []
    const kept = existingEntries.filter((entry) => !isOwnedByUranus(entry))
    const generated = groupByMatcher(entries).map(({ matcher, commands }) => ({
      matcher: matcher ?? '',
      hooks: commands.map((command) => ({
        type: 'command',
        command: `${command} ${HOOK_MARKER}`,
      })),
    }))
    hooks[event] = [...kept, ...generated]
  }

  const merged = { ...settings, hooks }
  return `${JSON.stringify(merged, null, 2)}\n`
}

function groupByMatcher(
  entries: readonly HookCommand[],
): readonly { matcher: string | undefined; commands: readonly string[] }[] {
  const byMatcher = new Map<string, string[]>()
  for (const entry of entries) {
    const key = entry.matcher ?? ''
    const list = byMatcher.get(key) ?? []
    list.push(entry.command)
    byMatcher.set(key, list)
  }
  return [...byMatcher].map(([matcher, commands]) => ({
    matcher: matcher === '' ? undefined : matcher,
    commands,
  }))
}

function isOwnedByUranus(entry: unknown): boolean {
  if (!isRecord(entry)) return false
  const innerHooks = entry['hooks']
  if (!Array.isArray(innerHooks)) return false
  return innerHooks.some(
    (h) => isRecord(h) && typeof h['command'] === 'string' && h['command'].includes(HOOK_MARKER),
  )
}

function parseJsonObject(raw: string | undefined): Record<string, unknown> {
  if (raw === undefined || raw.trim() === '') return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Hooks que o Uranus registra por padrão — relay de atividade pro dashboard (Fase C). */
export function defaultHooks(): readonly HookCommand[] {
  return [
    { event: 'UserPromptSubmit', command: 'uranus relay UserPromptSubmit' },
    { event: 'Stop', command: 'uranus relay Stop' },
    // `SubagentStart`/`SubagentStop` são hooks nativos do Claude Code (não
    // `PreToolUse` com matcher — essa era a versão antiga daqui: o matcher é
    // regex não-ancorada, e `matcher: 'Task'` também batia em `TaskCreate`/
    // `TaskGet`/`TaskList`/`TaskUpdate` (a lista de afazeres, que muda a
    // cada item riscado) — cada uma dessas chamadas gerava um processo
    // `uranus relay` novo, e é isso que deixava a sessão pesada. Sem
    // matcher aqui, os dois disparam pra qualquer tipo de subagente.
    { event: 'SubagentStart', command: 'uranus relay SubagentStart' },
    { event: 'SubagentStop', command: 'uranus relay SubagentStop' },
  ]
}

export interface WriteClaudeConfigOptions {
  readonly projectDir: string
  readonly projectName: string
  readonly digest?: ProjectDigest
  readonly dashboardUrl?: string
  /**
   * Instruções do projeto (ver `instructions.ts`). As sem `scope` entram no
   * `CLAUDE.md` da raiz; as com `scope` viram um `CLAUDE.md` só naquela pasta
   * — é assim que um monorepo/multi-projeto tem contexto por área sem exigir
   * mecanismo novo: o Claude Code já lê o `CLAUDE.md` mais próximo de onde
   * está trabalhando.
   */
  readonly instructions?: readonly ClaudeMdInstruction[]
}

export interface WriteClaudeConfigResult {
  readonly wrote: readonly string[]
}

/**
 * Gera/atualiza `.claude/` no projeto — o passo que "já deixa o Claude
 * treinado" antes do usuário abrir `uranus chat`. Chamado no `init` e
 * disponível via `uranus claude sync` para reexecutar depois de mudar o
 * catálogo, o digest do projeto ou as instruções.
 */
export async function writeClaudeConfig(
  options: WriteClaudeConfigOptions,
): Promise<WriteClaudeConfigResult> {
  const claudeDir = join(options.projectDir, '.claude')
  const agentsDir = join(claudeDir, 'agents')
  await mkdir(agentsDir, { recursive: true })
  const wrote: string[] = []

  const allInstructions = options.instructions ?? []
  const projectWide = allInstructions.filter((i) => i.scope === undefined)

  const claudeMdPath = join(options.projectDir, 'CLAUDE.md')
  const existingClaudeMd = await readFile(claudeMdPath, 'utf8').catch(() => undefined)
  const body = renderClaudeMdBody({
    projectName: options.projectName,
    ...(options.digest === undefined ? {} : { digest: options.digest }),
    ...(options.dashboardUrl === undefined ? {} : { dashboardUrl: options.dashboardUrl }),
    ...(projectWide.length === 0 ? {} : { instructions: projectWide }),
  })
  await writeFile(claudeMdPath, mergeManagedBlock(existingClaudeMd, body), 'utf8')
  wrote.push('CLAUDE.md')

  const byScope = new Map<string, ClaudeMdInstruction[]>()
  for (const note of allInstructions) {
    if (note.scope === undefined) continue
    const list = byScope.get(note.scope) ?? []
    list.push(note)
    byScope.set(note.scope, list)
  }
  for (const [scope, notes] of byScope) {
    const scopedDir = join(options.projectDir, scope)
    await mkdir(scopedDir, { recursive: true })
    const scopedPath = join(scopedDir, 'CLAUDE.md')
    const existingScoped = await readFile(scopedPath, 'utf8').catch(() => undefined)
    const scopedBody = [
      `# ${scope} — instruções específicas desta pasta`,
      '',
      'Complementa o `CLAUDE.md` da raiz do projeto; não o substitui.',
      '',
      ...renderInstructionsSection(notes),
    ].join('\n')
    await writeFile(scopedPath, mergeManagedBlock(existingScoped, scopedBody), 'utf8')
    wrote.push(join(scope, 'CLAUDE.md').replace(/\\/g, '/'))
  }

  for (const spec of AGENT_CATALOG) {
    const path = join(agentsDir, agentFileName(spec.id))
    await writeFile(path, renderAgentFile(spec), 'utf8')
    wrote.push(`.claude/agents/${agentFileName(spec.id)}`)
  }

  const settingsPath = join(claudeDir, 'settings.json')
  const existingSettings = await readFile(settingsPath, 'utf8').catch(() => undefined)
  await writeFile(settingsPath, mergeSettingsJson(existingSettings, defaultHooks()), 'utf8')
  wrote.push('.claude/settings.json')

  return { wrote }
}
