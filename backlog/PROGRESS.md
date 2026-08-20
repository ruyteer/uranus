# Progresso da execução do backlog

Arquivo de retomada. Atualizado ao fim de cada categoria e sempre que a
sessão se aproximar do limite de uso. Quem retomar deve ler este arquivo e o
`importante.md` antes de qualquer coisa.

## Linha de base (antes de qualquer mudança)

Medida em 2026-08-11, no working tree como estava:

- `pnpm run typecheck` → limpo
- `pnpm run test` → **682 testes, 41 arquivos, todos verdes** (~79s)
- Working tree tinha 74 arquivos modificados **não commitados** de trabalho
  anterior (Fase 7/8). Não foram tocados nem commitados por esta execução.

Se a suíte ficar vermelha, compare contra estes números — não presuma que a
quebra é nova.

## Ordem das categorias

| # | Categoria | Arquivo de origem | Estado |
|---|---|---|---|
| ① | Validações configuráveis + status de task | `validations.md` + `tasks.md` | **concluída** |
| ② | Backlog autônomo no `uranus start` | `backlog.md` | **concluída** (1 defeito conhecido) |
| ③ | Config guiada (wizard CLI) | `config.md` | **concluída** |
| ④ | Backlog cross-project | `escopo.md` | **concluída** |
| ⑤ | Dashboard: escrita, CRUD, redesign | `dashboard.md` | **concluída**, falta olhar no navegador |

Ordem escolhida por urgência: ① conserta o que quebra runs hoje (task
bloqueando em 3 erros); ⑤ vem por último porque consome as APIs que ①–④
criam.

## Decisões de arquitetura já tomadas

1. **Poppins + CSP** — a dashboard roda com `default-src 'none'` e não busca
   nada de fora. A fonte será embutida/servida localmente com
   `font-src 'self'`, preservando a política.
2. **Dashboard sem bundler** — mantém vanilla, como o comentário de decisão em
   `packages/dashboard/src/server.ts` justifica. O HTML monolítico de 963
   linhas será quebrado em assets estáticos servidos pelo mesmo servidor.
3. **Validações: default preserva o comportamento atual.** Afrouxar regra é
   opt-in explícito por projeto. O que muda para todos é só o *tratamento* da
   falha (não bloquear, reparo cirúrgico) e `maxAttemptsPerTask` 3 → 10.
4. **Sem estado novo na máquina de estados de Task.** Os estados são
   verificados exaustivamente pelos testes de caos; acrescentar um é risco
   desproporcional. A "melhor organização de status" que o `tasks.md` pede é
   entregue como agrupamento derivado (`TaskGroup`) + rótulos em pt-BR, sobre
   os mesmos 11 estados.

## Categoria ① — CONCLUÍDA

Portões finais: `pnpm run typecheck` limpo · `pnpm run lint` limpo ·
`pnpm run test` **730 testes / 43 arquivos, todos verdes** (base era 682/41 —
48 testes novos, zero regressão).

### O que passou a existir

- `packages/core/src/domain/validation.ts` — `ValidationRule` (10 regras),
  `ValidationSeverity` (`off`/`advisory`/`blocking`), `ValidationPolicy`,
  `resolveValidationPolicy()`, `severityOf()`, `isBlockingRule()`,
  `isRuleEnabled()`, `isValidationRule()`.
- Config: seção `validations` (`enabled`, `rules` parcial,
  `countTowardAttempts`, `maxRepairAttempts`). `maxAttemptsPerTask` 3 → 10.
- `Task.repairAttempts`, contador separado de `attempts`, persistido pela
  migração de state **v3 `task_repair_attempts`** (aditiva, `DEFAULT 0`, banco
  antigo lê 0 sem backfill).
- `TaskGroup` + rótulos pt-BR (`taskStateLabel`, `taskGroupLabel`).
- `packages/kernel/src/repair.ts` — classificação da falha e montagem do
  `RepairBrief`; caminho de reparo em `handleFailure`; evento
  `TaskRepairScheduled`; template de prompt `REPAIR_BRIEF_V1`.
- CLI: `uranus task status`, `uranus task delete`, `uranus validations`,
  `task list` agrupado; `packages/cli/src/task-view.ts` (funções puras).

### Decisões que quem retomar precisa conhecer

1. **`isBlockingRule`, não `isBlocking`** — o segundo já existia em
   `acceptance.ts` para outra coisa e o `export *` do index tornaria ambíguo.
2. **`config.validations.rules` chega PARCIAL.** Todo consumidor precisa
   chamar `resolveValidationPolicy()`. Sem isso a regra vem `undefined` e a
   validação passa a não fazer nada **em silêncio**.
3. **Contador de attempt: compensação.** `scheduleRepair` devolve a tentativa
   (`attempts - 1`), desfazendo o `countAttempt` da entrada em `running`. A
   alternativa (marcar o attempt como de reparo) exigiria que
   `decideAfterFailure` lesse o repositório, trocando uma função pura — que o
   teste de caos cobre exaustivamente — por uma com I/O.
4. **`Attempt.n` agora é `previousAttempts.length + 1`**, não
   `task.attempts + 1`. Consequência direta da decisão 3: `attempts` deixou de
   ser monotônico e a tabela tem `UNIQUE (task_id, n)`. O segundo reparo
   regravava `n = 1`, o insert falhava em silêncio e a task girava criando
   worktree para sempre (reproduzido: 37 ticks sem um `TaskStarted`).
5. **Contexto genérico de retry é suprimido quando há brief de reparo**, não
   somado — o texto padrão manda "não repita a mesma abordagem", e em reparo a
   abordagem anterior é exatamente a que deve ser repetida sem a violação.
6. **Um único check reprovado fora da política tira a falha inteira do
   reparo.** Escopo violado *e* teste quebrado tem defeito dentro; reparo não
   é para defeito.
7. O caminho de gates bloqueantes nunca vira reparo (`gateVerification` emite
   `category: 'unknown'`).

### Correções minhas, fora do escopo dos agentes

- `packages/cli/src/main.ts` — `task add` tinha `maxAttempts` fixo em 3,
  ignorando a config. Anularia a categoria inteira para toda task criada pelo
  CLI. Achado só no teste e2e; os unitários não pegaram.
- `packages/providers/src/api/api-provider.ts:280` — asserção redundante que
  deixava `pnpm run lint` vermelho. **Pré-existente** (arquivo modificado às
  10:41, antes desta sessão), não regressão nossa.
- `packages/kernel/src/planning.test.ts:158` — TS2352 pré-existente, também
  anterior a esta sessão. Corrigido pelo agente C de passagem.
- `README.md` e `docs/00-ARCHITECTURE.md` — exemplo de config atualizado com
  `maxAttemptsPerTask: 10` e a seção `validations`.

### Verificação e2e feita à mão (não só unitária)

Projeto temporário real, CLI compilado. Verificados: `init`; `validations` com
default e com override parcial (procedência "default do Uranus" vs.
`validations.rules` correta); `task add` respeitando `0/10`; `task status`
recusando transição ilegal com a lista de destinos válidos; `blocked` sem
`--reason` recusado; `task delete` sem TTY **recusando** em vez de assumir
"sim"; id inexistente abortando sem apagar nada; `task list` agrupado com
"Precisa de você" primeiro.

### Pendências conhecidas (não bloqueiam)

- Regras `lint`, `types` e `schema` existem na policy e aparecem em
  `uranus validations`, mas ainda não são consultadas dentro de
  `packages/executors` — `commandCheckImpl`/`schemaCheckImpl` não recebem
  policy. Hoje elas só têm efeito através do mapeamento de reparo. Fechar
  quando houver check dedicado para elas.
- `prepare()` falhando devolve a task para `ready` sem limite — loop infinito
  silencioso para qualquer erro persistente de preparação. **Pré-existente**,
  descoberto pelo agente C ao investigar o bug do `n`. Vale uma task própria.

## Categoria ② — CONCLUÍDA (com 1 defeito conhecido, ver abaixo)

Portões finais: `pnpm run typecheck` limpo · `pnpm run lint` limpo ·
`pnpm run test` **780 testes / 46 arquivos, todos verdes** (base da categoria
② era 730/43).

### O que passou a existir

- `Task.backlogItemId?: string` — link reverso task → item, **persistido**
  (migração de state **v4 `task_backlog_item`**, coluna + índice, aditiva).
- Config: seção `backlog` (`autoPlan` default `true`, `maxPlanningFailures`
  default 2).
- `StoredBacklogItem.planningFailures?` e `.startedAt?`.
- `backlogProgress(tasks)` em `packages/backlog/src/progress.ts` (função pura).
- `BacklogPort` exportada de `@uranus/kernel` — 3 métodos (`nextPlannable`,
  `plan`, `taskFinished`), implementada em `packages/cli/src/backlog-port.ts`.
  O kernel **não** depende de `@uranus/backlog`.
- Kernel drena o backlog em `runTick`, no ponto onde antes devolvia
  `'drained'`. Fecha o item sozinho após `TaskCompleted`.
- Eventos `BacklogItemPlanned`, `BacklogItemPlanningFailed`,
  `BacklogItemCompleted`.
- CLI: `backlog list` com progresso, `backlog show <id>` (novo), `backlog add`
  guiado (só com TTY), `task list` mostrando o item de origem.

### Decisões que quem retomar precisa conhecer

1. **"1 item por vez" não tem trava.** Sai da posição da chamada: só se
   planeja quando `workable === 0`. Não acrescente semáforo nem campo de
   "item corrente" — seria redundante e daria margem a divergir do estado real.
2. **A checagem de orçamento NÃO foi movida para antes do bloco de backlog.**
   Mover regride um caminho real: fila vazia + orçamento estourado +
   `onExhausted: pause` passaria a pausar e ficar ocioso para sempre, em vez
   de encerrar o run. Em vez disso `planFromBacklog()` faz a própria checagem
   `isBudgetExhausted` como pré-condição, antes de tocar a porta — zero tokens
   gastos, e sem porta injetada o comportamento é byte-idêntico ao anterior.
3. **`replanTask` propaga o `backlogItemId` real da task**, não o id sintético
   `replan-<taskId>` — este amarraria as filhas a um item que não existe em
   store nenhum, e o item verdadeiro nunca poderia fechar.
4. **Tasks derivadas de achado herdam o `backlogItemId`** da task de origem.
   Sem isso uma filha fica fora da contagem e o item nunca fecha.
5. **`tasksOfItem` cai no `planId`** quando a task não tem `backlogItemId` —
   senão todo item planejado antes desta categoria mostraria "0/0" para
   sempre, indistinguível de "o plano não gerou nada".
6. **Exceção durante o planejamento faz o kernel drenar**, não devolver
   `'worked'`: a porta pode não ter registrado a falha, e devolver `'worked'`
   giraria o laço para sempre no mesmo item. **É a causa do defeito abaixo.**
7. `backlogProgress`: task `failed` conta como `queued` (ela volta pra fila);
   `complete` exige `total > 0 && done > 0 &&` todas terminais.

### DEFEITO CONHECIDO — corrigir isto PRIMEIRO ao retomar

**Falha de planejamento por exceção não deixa rastro no item.**

Reproduzido em projeto real: o provider estourou (rate limit) durante
`planItem`; o run encerrou com a mensagem certa no log, mas o YAML do item
ficou **intacto** — sem `planningFailures`, sem `lastRejections`.

Consequência: (a) o humano roda `uranus backlog show` e não vê motivo nenhum
para o item não ter sido planejado; (b) o teto de `maxPlanningFailures` nunca
engata para esse modo de falha, então todo `uranus start` retenta o mesmo item
indefinidamente sem registrar nada.

Causa: `createBacklogPort().plan()` (em `packages/cli/src/backlog-port.ts`)
grava a falha quando `planning.planItem()` devolve um `Result` de erro, mas o
caminho de **exceção lançada** escapa antes disso. O kernel (decisão 6 acima)
apenas captura e drena.

Correção: envolver a chamada a `planItem` em try/catch dentro de `plan()`,
gravando `planningFailures + 1` e `lastRejections: [mensagem do erro]` também
no caminho de exceção, antes de repropagar ou devolver `undefined`. Já existe
tratamento análogo para "provider fora do ar" no caminho de `Result` de erro —
siga o mesmo formato. Acrescente teste em
`packages/cli/src/backlog-port.test.ts` com um `planItem` que lança.

### Verificação e2e feita à mão

Projeto temporário real, CLI compilado. Verificados: `backlog add` (ordenação
por prioridade desc correta); `backlog list` com coluna de progresso;
`backlog show` com corpo, estado, subtasks e o caso "ainda não planejado";
`backlog add` sem TTY recusando o modo guiado com **exit 1** e explicando a
forma não-interativa; e — o principal — `uranus start` **planejando o item de
maior prioridade sozinho**, sem `uranus plan`, chamando o Planner de verdade.

O plano foi recusado pelo validador com "projeto em modo restrito (sem sinal
de verificação): apenas tasks 'test' são aceitas" — comportamento **correto**
do validador num projeto temporário vazio, não defeito.

Custo desse teste com provider real: **US$ 0,17 / 52.975 tokens**.

## Categoria ① — arquivo do contrato dos agentes

Documento de contrato dos agentes:
`scratchpad/cat1-design.md` (fora do repo; o conteúdo essencial está resumido
nas decisões acima e no `validations.md`/`tasks.md`).

Divisão em 4 agentes, por fronteira de arquivo:

- **A — core+config**: `core/src/domain/validation.ts` (novo), `task.ts`,
  `state-machine.ts`, `core/src/index.ts`, `config/src/schema.ts`.
  → despachado
- **B — verificação**: `executors/src/verifier/checks.ts`. → aguarda A
- **C — kernel+prompts**: `kernel/src/kernel.ts`, `prompts/src/*`,
  `core/src/domain/events.ts`. → aguarda A
- **D — state+cli**: `state/src/migrations.ts`,
  `state/src/repositories/task-repository.ts`, `cli/src/main.ts`,
  `cli/src/composition.ts`, `cli/src/pretty.ts`. → aguarda A

## Categorias ③, ④ e ⑤ — CONCLUÍDAS

Portões finais: `typecheck` limpo · `lint` limpo · `test` **882 testes / 49
arquivos**. Base do início de tudo: 682/41.

### ③ Config guiada
`prompt-kit.ts` (primitivas com `PromptIo` injetável, selects **numerados**),
`config-wizard.ts` (`CONFIG_CATEGORIES` como **dado**, 8 categorias),
`config-file.ts` (edição de YAML preservando comentários, navegação do schema
sem importar zod). Comandos: `uranus config`, `config show`, `config set`, e
`init` guiado com `--yes` byte a byte idêntico ao anterior.

**Decisão que salvou o recurso:** a especificação de "sugestão quando o campo
está vazio" era letra morta — quase todo campo tem default, então vazio nunca
acontece. Usa-se o mapa `origins` do `loadConfig` para distinguir "o dono
escreveu" (nunca contradiz) de "é default" (a detecção manda).

**Por que o wizard é dado e não código:** a aba Configuração do painel
renderiza `CONFIG_CATEGORIES` vindo da API. Uma definição, duas telas, sem
divergência possível.

### ④ Backlog cross-project
`linkedProjects[].backlogWrite` (default **false**) e `.description`;
`BacklogItem.source += 'linked-project'`; campo `crossProject` no
`PLAN_OUTPUT_SCHEMA`; `packages/backlog/src/cross-project.ts`; porta
`CrossProjectBacklog` implementada em `composition.ts`.

Verificado com dois projetos reais: o item nasce no backlog do vizinho com
procedência (`uranus:frontend:<item>:<slug>`), labels `cross-project` e
`origem:frontend`, e a segunda criação devolve `created: false`.

**Origem = `backlogItemId ?? item.id`**, nunca `item.id` puro: no
replanejamento o id é o sintético `replan-<taskId>` e daria uma cópia por
replan no vizinho.

### ⑤ Dashboard
**Servidor** (`packages/dashboard/src/`): `data.ts`, `views.ts`,
`data-routes.ts`, `http.ts`, `static-files.ts`. Rotas de CRUD para tasks,
backlog, config e validações. **O servidor traduz** — `stateLabel`,
`groupLabel`, `tone`, `updatedLabel`, `progress.label` — o cliente é burro de
propósito.
**Front** (`packages/dashboard/public/`): 21 arquivos, módulos ES nativos, sem
bundler. 12 abas; kanban de backlog com arrastar; CRUD de task com formulário
de campos de verdade (nunca textarea de YAML); Validações com seletor de 3
estados; Configuração renderizada da API.
**Fonte:** Poppins 300/400/500/600 em `public/fonts/`, baixada e servida
localmente (SIL OFL 1.1). Não estava instalada no sistema, e as três
referências de design só usavam CDN — `local()` teria caído no fallback e o
painel não usaria Poppins. **Peso 700 não existe**: onde o design pedia, usa-se
600, porque negrito sintético fica pior que o peso real.

### Três defeitos de integração achados e corrigidos

1. **CSP incompleta (meu erro de contrato).** Eu especifiquei só
   `font-src 'self'`; sem `'self'` também em `script-src`/`style-src`, os
   assets separados seriam bloqueados e a quebra do monolito não funcionaria.
2. **Token barrava os próprios assets.** `authorize` rodava antes de tudo, mas
   o navegador não propaga `?token=` para sub-recurso (CSS, módulos, `.woff2`)
   — todos tomavam 401 e o painel travava na tela de carregamento sempre que
   `telemetry.dashboard.token` estivesse configurado, ou seja, exatamente na
   configuração que existe para expor o painel fora de loopback. Assets agora
   ficam fora do token (são código do painel, sem dado do projeto); `/api/`
   continua protegido. Coberto por teste.
3. **Lint da raiz vermelho.** O lint é tipado e tentava analisar os `.js` de
   `public/`, que não pertencem a nenhum tsconfig. Ambos os agentes rodaram só
   o lint do próprio diretório e não viram. `packages/*/public/**` entrou nos
   `ignores`; a verificação desses arquivos é `node --check`.

### Verificação e2e do painel (sem navegador)

Servidor real, binário compilado, projeto temporário. Confirmados: criar task
(e recusa sem escopo); transição ilegal recusada com rótulo em português;
`blocked` sem motivo recusado; delete e delete repetido; criar item e mover de
coluna; `PATCH /api/validations` **gravando no YAML e o CLI enxergando**
(`uranus validations` mostra `scope advisory · validations.rules`); assets sem
token 200 e `/api` 401; zero recurso externo nos assets; os 4 `.woff2`
respondendo com `font/woff2`.

**O que NÃO foi verificado:** a aparência renderizada. A extensão de navegador
não estava disponível nesta sessão. Tudo o que viraria erro de console foi
coberto por um harness em Node que renderizou as 12 abas em 4 estados e
disparou os 48 handlers de clique, mas ninguém *olhou* a tela.

## PONTO DE RETOMADA (parada por limite de uso — 2026-08-11)

**Por que paramos:** o `importante.md` manda parar por volta de 75% do limite
da sessão. Durante o teste e2e da categoria ②, o próprio provider reportou
`rateLimitType: seven_day`, `utilization: 0.77`, `surpassedThreshold: 0.75`.
Parada deliberada, não falha.

**Estado do repositório:** nada commitado, em nenhuma categoria. O working
tree tem as mudanças de ① e ② por cima dos 74 arquivos modificados que já
existiam antes desta execução.

**Portões no momento da parada:** `typecheck` limpo · `lint` limpo ·
`test` **780 testes / 46 arquivos, todos verdes**.

### Ordem de trabalho ao retomar

1. **Corrigir o defeito conhecido da categoria ②** (falha de planejamento por
   exceção não deixa rastro no item) — está descrito com causa, arquivo e
   correção na seção da categoria ②, logo acima.
2. **Categoria ③ — config guiada** (`config.md`). Ainda não iniciada, nenhum
   arquivo tocado. `uranus init` hoje escreve um YAML fixo em
   `packages/cli/src/main.ts` (~linha 32) e **não existe** comando
   `uranus config`. Precisa de fluxo guiado por categorias, perguntas,
   selects e sugestões, mantendo o YAML como formato final. Já há dois
   precedentes de interação com TTY no `main.ts` para seguir:
   `confirmarNoTerminal` (do `task delete`) e o modo guiado do `backlog add`.
   O wizard deve saber configurar a seção `validations` de ① e a seção
   `backlog` de ② — são as duas que mais importam para usuário leigo.
3. **Categoria ④ — backlog cross-project** (`escopo.md`). Não iniciada.
   Base já pronta: `linkedProjects` em `packages/config/src/schema.ts:207`
   (hoje só empresta memória read-only) e o `FileBacklogStore`, que aceita
   `dir` arbitrário — escrever no backlog do vizinho é apontar o store para o
   `.uranus/backlog` dele. Falta: flag de permissão de escrita por vizinho, o
   Planner detectar a dependência e criar o item lá, e origem rastreável no
   item criado.
4. **Categoria ⑤ — dashboard** (`dashboard.md`). Não iniciada, é a maior.
   Ver as 2 decisões de arquitetura já tomadas no topo deste arquivo (fonte
   Poppins servida localmente por causa do CSP; sem bundler, quebrando o HTML
   monolítico de 963 linhas em assets estáticos). As 3 pastas de referência de
   design foram confirmadas existentes: `D:\7store`,
   `G:\Trabalho\orionbot\ui`, `D:\sete-bot\src\tutorial`.

### Como o trabalho foi organizado (repetir o padrão)

Um documento de contrato por categoria no scratchpad, com a divisão por
**fronteira de arquivo** — dois agentes nunca no mesmo pacote. O agente do
contrato compartilhado (tipos em `core` + `config`) vai **sozinho primeiro**;
os demais em paralelo depois. Quando dois agentes paralelos precisam concordar
sobre uma interface, o orquestrador **fixa a assinatura no despacho** em vez
de deixar um esperar pelo outro — foi o que destravou F e G na categoria ②.

Exigir de todo agente: rodar `tsc -p`, `vitest run` e `eslint` do próprio
pacote e **colar a saída real**. Vários relatórios se revelaram precisos por
causa disso; um agente atribuiu erradamente um erro pré-existente a "outro
agente em voo" e só foi possível desmentir porque havia saída real para
conferir.

**Testar o binário de verdade, não só os unitários.** Os dois defeitos mais
graves desta execução (o `maxAttempts` fixo em 3 na categoria ①, e o rastro
perdido na ②) passaram por toda a suíte verde e só apareceram rodando o CLI
compilado num projeto temporário.
