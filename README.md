# Uranus

Uranus é um framework que orquestra modelos de IA capazes de editar código (Claude Code, e no
futuro Codex, GPT e Gemini) para trabalhar em projetos de software com supervisão humana.

A ideia central é simples: o modelo de IA faz o trabalho de programar, mas quem decide o que fazer,
em que ordem, com qual contexto e se o resultado ficou bom é sempre código determinístico, nunca o
próprio modelo. Isso torna o processo previsível, auditável e reproduzível.

**Status atual:** as fases 1 a 8 estão concluídas e a fase 9 está em andamento. O Uranus já funciona
de ponta a ponta: você escreve um pedido em texto livre, ele vira um plano validado, o plano vira
tasks, cada task é implementada num ambiente isolado, verificada por testes, revisada por qualidade
e vira um commit e um Pull Request. Se o processo for interrompido, ele retoma exatamente de onde
parou. Funciona com o Claude Code ou com modelos locais (Ollama, LM Studio, llama.cpp) e qualquer
serviço compatível com a API da OpenAI. Também roda várias tasks em paralelo sem risco de conflito
entre elas.

---

## Índice

1. [Por que o Uranus existe](#por-que-o-uranus-existe)
2. [Instalação](#instalação)
3. [Começando em 5 minutos](#começando-em-5-minutos)
4. [Referência de comandos](#referência-de-comandos)
5. [Como escrever uma task](#como-escrever-uma-task)
6. [Configuração](#configuração)
7. [Modelos locais e outros provedores](#modelos-locais-e-outros-provedores)
8. [Como o Uranus funciona por dentro](#como-o-uranus-funciona-por-dentro)
9. [Múltiplos projetos](#múltiplos-projetos)
10. [Agentes](#agentes)
11. [Plugins](#plugins)
12. [Painel e custo](#painel-e-custo)
13. [Solução de problemas](#solução-de-problemas)
14. [Desenvolvendo o próprio framework](#desenvolvendo-o-próprio-framework)

---

## Por que o Uranus existe

A maioria dos agentes de código tem o mesmo problema: eles deixam o próprio modelo decidir o que
fazer, quando terminou e se o resultado é bom. Isso funciona às vezes, mas não é confiável: o
resultado muda a cada execução, ninguém consegue auditar a decisão e ela não é reproduzível.

O Uranus separa as duas coisas. O modelo transforma intenção em código (é bom nisso). Todo o resto,
como decidir o que fazer agora, em que ordem, com qual contexto, com quais permissões e se deu
certo, é responsabilidade de código comum, testável e previsível.

Isso se apoia em seis princípios:

1. **Sucesso é provado por código.** Toda task tem um contrato de aceite que roda de verdade. O
   veredito é o resultado desse teste, nunca a opinião do modelo sobre o próprio trabalho.
2. **O modelo nunca decide o fluxo.** Tudo que o modelo produz é tratado como dado. Planos e
   descobertas passam por validação antes de virarem trabalho real.
3. **Todo efeito colateral vira um evento.** Existe um log que registra tudo que aconteceu, e esse
   log é a fonte da verdade.
4. **Todo ciclo termina em um ponto de recuperação.** Se o processo for interrompido, o máximo que
   se perde é um passo.
5. **A escrita de código só acontece num ambiente isolado.** A integração com o projeto principal
   acontece por Pull Request.
6. **Orçamento é um limite rígido.** Dinheiro, tokens e tempo são verificados antes de gastar, não
   depois.

Os detalhes de arquitetura estão em [docs/00-ARCHITECTURE.md](docs/00-ARCHITECTURE.md).

---

## Instalação

Você precisa de Node 22 ou mais recente, git 2.20 ou mais recente, e pelo menos um provedor de
modelo: o [Claude Code CLI](https://claude.com/claude-code) autenticado, ou qualquer servidor
compatível com a API da OpenAI, incluindo servidores locais (veja a seção
[Modelos locais](#modelos-locais-e-outros-provedores)). O `gh` (GitHub CLI) é opcional: sem ele, os
commits ficam numa branch local em vez de virarem Pull Request automaticamente.

```bash
git clone https://github.com/ruyteer/uranus.git
cd uranus
pnpm install
pnpm build
```

Deixe o comando `uranus` disponível em qualquer lugar do seu computador:

```bash
cd packages/cli
npm link
```

Autentique o Claude Code CLI (só precisa fazer isso uma vez):

```bash
claude /login
```

Confirme que tudo está funcionando:

```bash
claude --version
```

---

## Começando em 5 minutos

### 1. Inicialize no seu projeto

O projeto precisa ser um repositório git com a árvore de trabalho limpa (sem mudanças pendentes).

```bash
cd meu-projeto
uranus init
```

Isso cria uma pasta `.uranus/` com a configuração padrão. Essa pasta já nasce ignorada pelo git do
seu projeto.

### 2. Verifique o ambiente

```bash
uranus doctor
```

Você deve ver `OK` para node, git, claude e a configuração. Ver `AVISO` para o `gh` é normal se
você não instalou o GitHub CLI.

### 3. Veja o que o Uranus entendeu do seu projeto

```bash
uranus context show
```

Esse comando mostra um resumo automático do seu projeto: linguagens, frameworks, como rodar os
testes, se tem CI, banco de dados, convenções de código. Preste atenção no "sinal de verificação":
se ele estiver abaixo de 30 de 100, o Uranus entra em modo restrito e só aceita tasks que
construam testes, porque sem testes não há como provar que o código funciona.

### 4. Descreva o que você quer, em texto livre

```bash
uranus backlog add "Adicionar exportação em CSV" --body "O relatório hoje só exporta PDF. Quero também CSV, com as mesmas colunas e um teste cobrindo."
```

### 5. Deixe o Uranus transformar isso em tasks

```bash
uranus backlog list
```

Pegue o id do item que você criou e peça um plano:

```bash
uranus plan adicionar-exportacao-em-csv-abc123
```

Um agente chamado Planner propõe um plano de tasks, e um validador determinístico aceita ou recusa
esse plano com motivos objetivos (escopo grande demais, contrato de aceite fraco, dependência que
não existe). Um plano recusado nunca chega a tocar no seu código.

### 6. Trabalhe

```bash
uranus start
```

Para cada task, o Uranus cria um ambiente isolado, chama o Claude Code, roda os testes do seu
projeto, passa pela revisão de qualidade, faz um commit numa branch própria e abre um Pull Request
como rascunho.

### 7. Acompanhe

```bash
uranus status
uranus task list
```

Se você interromper com `Ctrl+C`, pode retomar exatamente de onde parou:

```bash
uranus start --resume run_01ABC...
```

---

## Referência de comandos

### Projeto

| Comando | O que faz |
| --- | --- |
| `uranus init` | Cria `.uranus/` com a configuração padrão. Aceita `--name <nome>`. |
| `uranus doctor` | Verifica o ambiente: node, git, Claude Code CLI, gh e configuração. |
| `uranus status` | Mostra o estado da fila e do último run. |
| `uranus logs` | Mostra os últimos eventos do log. Aceita `--tail <n>`. |

### Backlog e planejamento

| Comando | O que faz |
| --- | --- |
| `uranus backlog add "<título>"` | Adiciona um item. Aceita `--body`, `--label` e `--priority 0 a 100`. |
| `uranus backlog list` | Lista os itens com estado e prioridade. |
| `uranus backlog import <arquivo.md>` | Importa itens de um arquivo Markdown. |
| `uranus plan <itemId>` | Transforma um item em tasks verificáveis. Isso gasta tokens. |

O backlog fica salvo em `.uranus/backlog/*.yaml`. Você pode editar esses arquivos à mão se quiser.

### Tasks

| Comando | O que faz |
| --- | --- |
| `uranus task add --file <yaml>` | Adiciona uma task direto, sem passar pelo Planner. |
| `uranus task list` | Lista as tasks, seus estados, tentativas e motivo de bloqueio. |
| `uranus task list --active` | Mostra só o que ainda vai acontecer ou está travado. |
| `uranus task why <taskId>` | Explica por que a task está (ou não está) sendo escolhida. |
| `uranus task retry <taskId>` | Devolve uma task bloqueada para a fila. |
| `uranus task prune` | Remove tasks concluídas antigas do estado ativo (não apaga o histórico). |

Quando a lista de tasks fica difícil de ler, use os filtros:

```bash
uranus task list --active
uranus task list --state done --limit 20
uranus task prune              # mostra o que seria removido, sem remover
uranus task prune --yes        # remove de verdade
```

O comando `prune` nunca remove uma task que está ativa no momento, uma task que ainda não rodou, ou
uma task de que outra ainda depende. Ele sempre te avisa quando isso acontece. E remover uma task
antiga da lista de tarefas não apaga o histórico dela: o registro completo continua no log de
eventos em `.uranus/events/`, que nunca é podado.

### Execução

| Comando | O que faz |
| --- | --- |
| `uranus start` | Trabalha até esvaziar a fila. `Ctrl+C` interrompe com segurança. |
| `uranus start --max-tasks <n>` | Para depois de completar N tasks. |
| `uranus start --resume <runId>` | Retoma um run que foi interrompido. |

### Contexto e memória

| Comando | O que faz |
| --- | --- |
| `uranus context show` | Mostra o resumo do projeto: stack, testes, CI, sinal de verificação. |
| `uranus context rebuild` | Reconstrói o resumo do zero, ignorando o cache. |
| `uranus memory list` | Lista as memórias ativas. Aceita `--scope <escopo>`. |
| `uranus memory show <id>` | Mostra uma memória completa. |
| `uranus memory compact` | Revalida as memórias e compacta os escopos que estão cheios. |

A memória fica em `.uranus/memory/<escopo>/*.md`, em Markdown legível. Você pode editar à vontade:
o Uranus detecta a edição manual e respeita a sua correção.

### Plugins

| Comando | O que faz |
| --- | --- |
| `uranus plugin list` | Mostra quais plugins ativaram, quais não, e o motivo de cada um. |
| `uranus plugin info <id>` | Mostra o manifesto, as permissões pedidas e o que o plugin registrou. |
| `uranus plugin check <dir>` | Audita um plugin antes de instalar: permissões e capacidades. |

### Painel e custo

| Comando | O que faz |
| --- | --- |
| `uranus dashboard` | Sobe o painel web em `localhost:4319`. |
| `uranus start --dashboard` | Roda o kernel com o painel aberto ao lado. |
| `uranus cost` | Mostra o custo do processo, por agente e por modelo. |
| `uranus cost reconcile <valor>` | Compara o total contabilizado com a sua fatura real. |

---

## Como escrever uma task

Você também pode pular o Planner e escrever a task direto, em YAML:

```yaml
kind: feature # feature | bugfix | refactor | test | docs | chore | security | perf | deps | infra
title: Adicionar remoção de todos
intent: >
  Adicionar um método `remove(id)` ao store em src/todos.mjs que remove o todo
  com o id dado e retorna true, ou false se o id não existir. Cobrir com testes:
  remover existente, remover inexistente, e que list() reflete a remoção.

# Quais arquivos a task pode alterar. Mudança fora daqui é reprovada automaticamente.
touches:
  - src/**
  - test/**

maxAttempts: 3

# O contrato de aceite é o coração do sistema. A task só vira "concluída" se
# TODOS os testes abaixo passarem, nunca pela palavra do modelo.
acceptance:
  checks:
    - kind: command # roda um comando; o resultado decide se passou
      id: suite-passa
      run: node --test
      timeoutMs: 120000

    - kind: artifact # verifica que um arquivo existe e casa com um padrão
      id: metodo-existe
      path: src/todos.mjs
      mustExist: true
      matches: 'remove\('
      timeoutMs: 5000

    - kind: diff # limites sobre o próprio diff produzido
      id: escopo
      requireNonEmpty: true # pega o caso em que o modelo diz "pronto" sem mudar nada
      timeoutMs: 30000
```

```bash
uranus task add --file minha-task.yaml
```

### Tipos de teste disponíveis

| Tipo | Para que serve |
| --- | --- |
| `command` | Roda um comando qualquer; passa se o resultado for o esperado. |
| `tests` | Roda a suíte de testes do projeto. Pode exigir teste novo no diff. |
| `artifact` | Verifica se um arquivo existe e, se quiser, se bate com uma expressão. |
| `diff` | Limites de tamanho, escopo e não vazio sobre o diff produzido. |
| `coverage` | Cobertura mínima de testes, global ou só do que mudou. |
| `schema` | Valida a saída estruturada do agente contra um schema JSON. |

Qualquer teste pode receber `advisory: true`. Nesse caso, ele registra o resultado mas nunca
bloqueia a task.

---

## Configuração

Tudo fica em `.uranus/config.yaml`. Você só precisa declarar o que quer mudar, o resto usa valores
padrão seguros.

```yaml
version: 1

project:
  name: meu-projeto
  vcs:
    defaultBranch: main
    branchPrefix: 'uranus/'

kernel:
  concurrency: 1 # mais que 1 roda tasks em paralelo, protegendo arquivos automaticamente
  maxAttemptsPerTask: 10
  leaseTtlMs: 600000

# Quais validações o Uranus faz, e com que rigor. Tudo bloqueante por padrão.
validations:
  enabled: true
  rules:
    scope: blocking # diff fora dos arquivos declarados na task
    diffSize: blocking # tamanho máximo de arquivos e linhas
    forbiddenPaths: blocking
    emptyDiff: blocking # o modelo disse "pronto" sem alterar nada
    tests: blocking
    requireNewTests: blocking
    forbidSkipped: blocking
    lint: blocking
    types: blocking
    schema: blocking
  countTowardAttempts: false
  maxRepairAttempts: 3

# Limite duro de gasto, verificado antes de cada ação, não depois.
budget:
  perRun: { usd: 25, tokens: 5000000, wallclockMs: 14400000 }
  perTask: { usd: 3, tokens: 500000, wallclockMs: 1200000 }
  onExhausted: pause # pause | stop | ask

providers:
  default: claude-code
  entries:
    claude-code:
      model: sonnet # ou opus, haiku
      binary: /caminho/para/claude # só se não estiver no PATH

context:
  budgetTokens: 120000
  sections: { digest: 0.15, code: 0.4, memory: 0.2, task: 0.15, error: 0.1 }

scheduler:
  weights:
    blocker-first: 10
    starvation-guard: 8
    bug-priority: 6
    mix-quota: 3
  mix: { feature: 0.5, bugfix: 0.25, refactor: 0.15, docs: 0.1 }
  wipLimit: 4

# Cadeia de qualidade: roda entre a verificação por testes e o commit.
quality:
  enabled: true
  gates:
    - { agent: reviewer, enabled: true }
    - { agent: security, enabled: true }
    - { agent: qa, enabled: false }
  blockAt: high # severidade mínima que impede a integração
  followUpAt: high # a partir dessa severidade, o achado vira task
  followUp:
    maxGeneration: 1 # correção de correção não gera nova correção
    maxPerRun: 8 # teto de tasks derivadas por run
    denyCategories: [] # vazio usa a lista padrão (naming, style, docs...)
  escalationAgent: bug-hunter

integration:
  strategy: pull-request # pull-request | branch-only | direct
  draftPullRequests: true
  requireHumanApproval: [merge, force-push, ci-change, migrations, new-dependency, budget]

permissions:
  fsWrite: ['**']
  fsDeny: ['.git/**', '.env', '.env.*', '**/node_modules/**']
  execAllow: []

memory:
  maxRecordsPerScope: 200
  minConfidence: 0.3

# Projetos vizinhos, como backend e frontend em repositórios separados, cada
# um com seu próprio .uranus. A memória deles entra como contexto só de leitura.
linkedProjects:
  - path: ../core
    alias: core
    scopes: [convention, architecture]
    limit: 6

telemetry:
  logLevel: info # trace | debug | info | warn | error | silent
```

Você também pode sobrescrever qualquer configuração por variável de ambiente
(por exemplo, `URANUS_BUDGET__PER_RUN__USD=5`) ou por uma configuração global em
`~/.uranus/config.yaml`.

---

## Modelos locais e outros provedores

O Uranus não depende do Claude Code. Qualquer servidor compatível com a API da OpenAI funciona,
incluindo Ollama, LM Studio, llama.cpp e vLLM rodando na sua própria máquina, além de serviços como
OpenAI, OpenRouter, Groq e Gemini.

### Dois modos de provedor

|  | `cli` (Claude Code) | `api` (todos os outros) |
| --- | --- | --- |
| Quem edita os arquivos | O CLI da Claude | O próprio Uranus |
| Quando a permissão é checada | Ao montar as instruções | A cada chamada de ferramenta |
| Fonte da verdade do diff | `git diff` | `git diff` (igual) |

O modo `api` é mais seguro: como o loop de ferramentas roda dentro do próprio Uranus, uma escrita
fora do escopo permitido é bloqueada antes de acontecer, em vez de ser descoberta depois.

### Configurando um modelo local

```yaml
providers:
  default: ollama
  entries:
    ollama:
      mode: api
      preset: ollama
      model: qwen2.5-coder:14b
      # baseUrl: http://127.0.0.1:11434/v1   (esse já é o padrão)
```

Existem presets prontos para `ollama`, `lmstudio`, `local` (qualquer servidor compatível com a API
da OpenAI), `openai-gpt`, `openrouter`, `groq` e `gemini`.

O modelo precisa suportar function calling. Isso não é opcional: sem essa capacidade, o agente não
consegue ler nem editar nenhum arquivo. Muitos modelos populares não suportam function calling, e o
`uranus doctor` detecta e avisa isso antes de você gastar uma task descobrindo:

```bash
uranus provider test
```

Se aparecer a mensagem "não suporta ferramentas", troque por um modelo com suporte, como
`qwen2.5-coder`, `llama3.1`, `mistral-nemo` ou `firefunction`.

Sobre o tamanho do modelo: um modelo de 7 bilhões de parâmetros normalmente dá conta de tarefas de
um único arquivo com verificação por testes. Em tarefas que exigem coordenar dois ou mais arquivos,
ele erra com frequência. Vale a pena combinar modelos: forte onde importa, local onde basta.

```yaml
providers:
  byAgent: { executor: claude-code, reviewer: ollama, security: ollama }
```

### Sobre a janela de contexto do Ollama

Esse é o ponto que mais causa problema silencioso: o Ollama não usa a janela nominal do modelo, e
sim o valor configurado em `num_ctx`, que na maioria das máquinas é apenas 4096. Quando o contexto
enviado é maior que isso, o Ollama descarta os tokens mais antigos sem avisar, e o modelo passa a
responder com confiança sobre um contexto que na verdade nunca recebeu.

O Uranus corta o pacote de contexto para caber na janela declarada, e registra o corte:

```
contexto reduzido de 120000 para 16384 tokens: "ollama" declara janela de 32768.
```

Declare em `contextLength` o valor real que você configurou no seu servidor (via
`OLLAMA_CONTEXT_LENGTH` ou no Modelfile). O padrão assumido é 4096, de propósito conservador:
declarar um valor menor custa contexto, declarar um valor maior custa correção.

### Chaves de API nunca vão direto na configuração

```yaml
providers:
  entries:
    openrouter:
      mode: api
      preset: openrouter
      model: anthropic/claude-sonnet-4
      apiKeyRef: env:OPENROUTER_API_KEY
```

O valor é lido da variável de ambiente só na hora de usar, e é automaticamente removido de
qualquer log, evento ou saída de comando.

### Comandos de provedor

| Comando | O que faz |
| --- | --- |
| `uranus provider list` | Lista os provedores registrados e o roteamento ativo. |
| `uranus provider test [id]` | Testa conectividade, modelo e suporte a ferramentas de verdade. |
| `uranus provider why <agente>` | Mostra qual provedor seria escolhido para um agente e por quê. |

---

## Como o Uranus funciona por dentro

### O ciclo do kernel

Cada iteração passa por dez fases, sempre terminando num ponto de recuperação:

```
recover → sense → select → admit → prepare → execute → verify → integrate → learn → checkpoint
```

1. **recover**: se houve interrupção, restaura o último ponto de recuperação íntegro.
2. **sense**: coleta permissões expiradas, atualiza estatísticas, replaneja tasks pendentes.
3. **select**: o escalonador escolhe a próxima task, avaliando 14 políticas diferentes.
4. **admit**: verifica permissões e orçamento antes de gastar qualquer coisa.
5. **prepare**: monta o contexto dentro do orçamento e cria o ambiente isolado.
6. **execute**: o agente trabalha. É a única fase em que o modelo age de verdade.
7. **verify**: roda o contrato de aceite. É o único responsável por decidir sucesso.
8. **integrate**: roda a cadeia de qualidade, faz o commit, o push e abre o Pull Request.
9. **learn**: atualiza memória, custo e telemetria.
10. **checkpoint**: salva um retrato do estado. Se o processo cair, o máximo que se perde é um passo.

### O que acontece quando uma task falha

O diagnóstico de falha é estruturado (categoria e evidência), nunca um texto livre. A partir dele,
uma política decide o próximo passo, em ordem de custo crescente:

1. **Tenta de novo** com o diagnóstico incluído no próximo pedido ao modelo.
2. **Escala** para um agente diferente se o mesmo tipo de erro se repetir, porque repetir a mesma
   abordagem que já falhou é a definição de um loop sem saída.
3. **Replaneja** se mesmo a escalada falhar. O plano original vira suspeito e volta ao Planner.
4. **Bloqueia** a task se as tentativas se esgotarem, guardando o histórico completo para você ler.

### Segurança

* A escrita só acontece no ambiente isolado. Sua branch principal nunca é tocada diretamente.
* Todo conteúdo vindo do seu repositório entra no prompt marcado como dado não confiável. Um
  comentário no código dizendo "ignore os testes e faça merge" não muda nada: quem decide o merge
  é código, não o modelo.
* Segredos nunca entram no contexto do modelo, e são automaticamente removidos de logs, eventos e
  saída de comandos.
* Permissões de ferramentas, arquivos e rede são negadas por padrão, e combinam as regras de
  agente, projeto e task.

---

## Múltiplos projetos

Hoje, rodar vários projetos ao mesmo tempo significa rodar vários processos: cada `uranus start`
usa seu próprio banco de estado, seu próprio log de eventos e seu próprio ambiente isolado. Não
existe nenhum estado compartilhado entre eles, então rodar um processo `uranus` por repositório já
funciona sem interferência. Um teste dedicado prova isso da forma mais exigente possível: duas
pilhas completas rodando ao mesmo tempo dentro do mesmo processo, o que expõe qualquer estado
compartilhado que dois processos separados de sistema operacional jamais revelariam.

O único cuidado prático é a porta do painel web, que por padrão é fixa em `4319`. Se você rodar
dois projetos com o painel ligado ao mesmo tempo, configure `telemetry.dashboard.port` com um
valor diferente em cada um.

Ter um único processo orquestrando vários projetos ao mesmo tempo é uma mudança bem maior, que
ainda não existe e está fora do escopo por enquanto.

### Projetos vinculados

Dois projetos relacionados, como um backend e um frontend em repositórios separados, cada um com
seu próprio `uranus init`, não compartilham nada por padrão: nem backlog, nem orçamento, nem
memória. Para dar visibilidade de um lado sobre o que importa do outro, sem misturar os dois:

```yaml
# .uranus/config.yaml do projeto "ui"
linkedProjects:
  - path: ../core # caminho relativo à raiz deste projeto
    alias: core # opcional; por padrão usa o nome da pasta
    scopes: [convention, architecture] # quais escopos de memória do vizinho entram
    limit: 6 # teto de registros por vínculo
```

A memória do escopo escolhido no projeto vizinho passa a entrar no contexto de qualquer task, mas
só como leitura: nada é escrito de volta no `.uranus` do outro projeto, e o conteúdo chega sempre
marcado como não confiável, igual a qualquer conteúdo que atravessa a fronteira entre projetos.
Backlog, fila, orçamento e escalonador continuam totalmente independentes.

---

## Agentes

O catálogo de agentes é declarativo: cada agente é um arquivo `.yaml` dentro de
`packages/agents/catalog/`. Mudar a missão, o escopo ou o critério de sucesso de um agente é
simplesmente editar esse arquivo, sem precisar recompilar nada.

| Agente | O que faz | Escreve código? |
| --- | --- | --- |
| `executor` | Implementa a task e produz um diff. | sim |
| `planner` | Transforma um item de backlog em tasks verificáveis. | não |
| `testing` | Constrói a base de testes em projetos que ainda não têm. | sim |
| `reviewer` | Revisa o diff contra corretude e convenções do projeto. | não |
| `security` | Audita o diff em busca de vulnerabilidades. | não |
| `qa` | Procura o que os testes que passaram ainda não cobrem. | não |
| `bug-hunter` | Reproduz, isola e corrige quando o executor falhou várias vezes. | sim |
| `refactor` | Reduz dívida técnica preservando o comportamento existente. | sim |
| `documentation` | Mantém a documentação sincronizada com o código. | sim |

Para personalizar um agente no seu projeto, crie um arquivo YAML em `.uranus/agents/` com o mesmo
nome do agente original. Ele sobrescreve o padrão do framework.

Agentes como Reviewer, Security e QA fazem julgamentos, mas não decidem o fluxo: eles produzem
achados com uma severidade, que é um dado. Uma política em código (`blockAt`, na configuração)
decide o que efetivamente bloqueia a integração.

### Por que o Uranus não gera tasks infinitas

Toda task concluída passa pelos gates de qualidade, e todo achado desses gates pode virar uma nova
task. Sem um limite claro, isso viraria uma bola de neve: a fila cresceria mais rápido do que
esvazia, e você acabaria recebendo dezenas de correções que nunca pediu.

Por isso existem cinco cortes automáticos, aplicados sempre em código, nunca pelo modelo:

| Corte | Regra | Configuração |
| --- | --- | --- |
| Geração | Correção de correção não gera nova correção. | `followUp.maxGeneration` (padrão 1) |
| Severidade | Achados abaixo do limiar viram informação, não task. | `followUpAt` (padrão `high`) |
| Categoria | Estilo, nome e formatação não geram Pull Request sozinhos. | `followUp.denyCategories` |
| Duplicata | A mesma queixa nunca vira duas tasks, mesmo entre runs. | automático |
| Teto do run | Limite total de tasks derivadas, somando todos os gates. | `followUp.maxPerRun` (padrão 8) |

Nada se perde: todo achado que não vira task automaticamente entra no backlog com o motivo
registrado, e você decide o que vale a pena promover, quando quiser.

```bash
uranus task list          # tasks derivadas aparecem marcadas com sua geração e origem
uranus task why <taskId>  # mostra de qual gate, geração e task ela veio
uranus backlog list       # tudo que os gates encontraram e a política não promoveu
```

---

## Plugins

O núcleo do Uranus não sabe o que é npm, Next.js ou Docker, e isso é proposital: todo conhecimento
específico de uma stack vive num plugin, e um plugin só se ativa quando o projeto é daquele tipo.

### O que já vem incluído

| Plugin | Ativa quando | Registra |
| --- | --- | --- |
| `node` | existe `package.json` | runners de teste, checagem de tipos, lint, build |
| `nextjs` | `next` está nas dependências, ou existe `next.config.*` | agente próprio, build, contexto |
| `docker` | existe `Dockerfile` ou `docker-compose.yml` | build e validação de compose |

O plugin `node`, por exemplo, descobre o gerenciador de pacotes pelo lockfile, o runner de testes
pelas dependências declaradas, e só registra checagens de lint ou build se os scripts realmente
existirem no projeto. Registrar uma checagem de lint num projeto sem lint só geraria uma task
reprovada por um comando que nem existe.

```bash
uranus plugin list
```

```
Ativos:
  node         arquivo "package.json" existe
               registrou: 3 checks, 1 fonte de contexto, 4 runners
  nextjs       dependência "next" em package.json
               registrou: 1 agente, 1 check, 1 fonte de contexto, 1 prompt

Inativos:
  docker       nenhuma regra de detecção casou com este projeto
```

Toda ativação vem com o motivo. Se uma checagem reprovar sua task, `uranus plugin list` mostra de
onde ela veio, sem você precisar investigar.

### Ligando e desligando plugins

Na forma curta, `plugins` é a lista do que deve ligar mesmo sem detecção automática:

```yaml
plugins: [node, nextjs]
```

Na forma longa, você pode desligar um plugin detectado e ajustar configurações por plugin:

```yaml
plugins:
  disabled: [docker]
  settings:
    node:
      testCommand: 'make test' # sobrepõe o que o plugin descobriria sozinho
    nextjs:
      buildCommand: 'pnpm build'
```

Cada plugin só enxerga sua própria configuração: o plugin `node` lê `testCommand`, mas nunca as
configurações do `nextjs`.

### Escrevendo um plugin próprio

Um plugin é uma pasta com um arquivo `uranus.plugin.json` e um módulo ES. Coloque a pasta em
`.uranus/plugins/<id>/`, ou publique como um pacote npm com `uranus-plugin` no nome.

```json
{
  "id": "storybook",
  "name": "Storybook",
  "version": "1.0.0",
  "uranus": "^0.1.0",
  "description": "Check de build do Storybook",
  "provides": { "checks": ["storybook:build"] },
  "permissions": { "fs": "read", "net": false, "exec": true },
  "detect": [{ "kind": "glob", "pattern": "**/*.stories.tsx" }]
}
```

```js
// index.js (lembre de declarar "type": "module" no package.json)
import { definePlugin, commandCheck } from '@uranus/plugins/sdk'

export default definePlugin(manifest, (context) => {
  context.registerCheck(
    commandCheck(context, {
      id: 'storybook:build',
      run: 'npx --no-install storybook build',
      timeoutMs: 600_000,
    }),
  )
})
```

Depois, use no contrato de aceite de uma task:

```yaml
checks:
  - kind: plugin
    id: build-storybook
    check: storybook:build
    timeoutMs: 600000
```

Um plugin pode registrar agentes, ferramentas, checagens, fontes de contexto, prompts, regras,
políticas de escalonamento e runners de teste. O que ele nunca alcança é o núcleo do Uranus, o
banco de estado e o log de eventos bruto.

### Sobre as permissões dos plugins

O manifesto de um plugin declara acesso a `fs`, `net`, `exec` e `secrets`. O padrão é o mais
restritivo possível: um plugin que esquece de declarar algo simplesmente não recebe acesso a isso.

Antes de instalar, você pode auditar:

```bash
uranus plugin check ./caminho/do/plugin
```

```
Telemetria (telemetria-secreta) v0.1.0

Ao instalar, você autoriza este plugin a:
  ler arquivos do projeto

Plugin "telemetria-secreta" usa capacidades não declaradas no manifesto:
  usa fetch() em index.js, mas não declara "permissions.net"
```

Seja realista sobre o que essa auditoria garante: plugins JavaScript rodam no mesmo processo que o
núcleo do Uranus, e não existe um sandbox real dentro do mesmo processo. A varredura compara o que
o código do plugin faz com o que o manifesto declara, o que pega descuido e atualização que ganhou
uma capacidade nova sem avisar, mas não pega alguém tentando burlar isso de propósito. Instalar um
plugin é confiar no autor dele, do mesmo jeito que instalar um pacote npm qualquer.

Se um plugin falhar (manifesto inválido, import quebrado, exceção na ativação), isso fica contido:
vira uma linha no relatório, o que ele já tinha registrado é desfeito, e o Uranus continua rodando
com uma capacidade a menos, sem nunca cair por causa disso.

---

## Painel e custo

```bash
uranus start --dashboard
```

O painel abre em `http://localhost:4319` e mostra o run acontecendo em tempo real. Ele é só um
observador: tudo que aparece ali vem do log de eventos, então nada no painel pode mostrar algo que
não tenha realmente acontecido. Ligar o painel não muda em nada o comportamento do kernel.

### As telas do painel

| Painel | O que mostra |
| --- | --- |
| Agora | Custo do run, orçamento consumido, tasks restantes, atividade recente. |
| Fila | Toda task, com estado, agente, tentativas, custo e motivo de bloqueio. |
| Timeline | O log de eventos, colorido por severidade. |
| Qualidade | Gates executados, bloqueios, achados e taxa de aprovação. |
| Custo | Total, projeção, por agente, por modelo, por task, e série dos últimos 14 dias. |
| Git | Commits e Pull Requests abertos, com o resumo do diff. |
| Memória | Memórias gravadas, conflitos, compactações e planos aceitos ou rejeitados. |
| Aprovações | Fila de aprovações pendentes, com botão de aprovar e negar. |
| Saúde | Provedores degradados ou em limite de uso, falhas de plugin, atividade recente. |

### Aprovando pela interface

Quando o kernel precisa de uma aprovação humana (merge, force push, mudança de CI, migração,
dependência nova, estouro de orçamento), ele para e a aprovação aparece no painel, com o diff e o
risco explicados. Um clique libera a task. A decisão fica registrada no log com o autor `dashboard`,
porque uma aprovação sem autor rastreável não seria supervisão de verdade.

### Onde o painel escuta

Por padrão, o painel só escuta em `127.0.0.1`, ou seja, só no seu próprio computador. Como ele
mostra o seu código e concede aprovações, expor na rede é uma decisão que você toma
conscientemente: fora do próprio computador, o servidor exige um token e se recusa a subir sem ele.

```yaml
telemetry:
  dashboard:
    enabled: true
    port: 4319
    host: 0.0.0.0
    token: um-token-longo-e-aleatorio
```

A página não carrega nada de fora, e toda resposta passa por uma remoção automática de segredos
antes de sair.

### O custo mostrado é o custo real

A contabilidade usa o valor real reportado pelo provedor do modelo (o Claude Code CLI, por exemplo,
reporta o custo direto em dólar). Uma tabela de preços interna só é usada como plano B, para
provedores que não reportam custo diretamente.

Isso importa porque a cadeia de qualidade multiplica o custo por task: cada gate é uma chamada a
modelo, e o painel mostra a divisão:

```
Por agente:
  executor    $1.6800   4 sessões
  reviewer    $0.0000   4 sessões     (modelo local)
  security    $0.0000   4 sessões     (modelo local)
```

A tabela de preços embutida representa preços públicos e pode ficar desatualizada. Você pode
corrigir sem esperar uma nova versão:

```yaml
telemetry:
  pricing:
    anthropic:
      - model: claude-sonnet
        inputPerMillion: 3
        outputPerMillion: 15
        effectiveFrom: '2026-01-01'
```

Os preços são versionados por data, então um run de três meses atrás continua sendo calculado com
o preço daquela época, mesmo que o preço atual mude depois.

Quando a fatura chegar, feche o ciclo:

```bash
uranus cost reconcile 42.17
```

```
Uranus reportou: $41.8300
Fatura:          $42.1700
Diferença:       0.8%

Dentro da tolerância de 3%.
```

Se a diferença passar da tolerância, a causa mais comum é um modelo sem preço cadastrado na tabela.
O Uranus avisa isso em tempo real quando acontece.

### Métricas para fora

`GET /api/metrics` expõe as métricas no formato do Prometheus. Para exportar via OpenTelemetry:

```yaml
telemetry:
  otlpEndpoint: http://localhost:4318
```

Se o coletor estiver fora do ar, isso nunca atrasa nem derruba um run.

---

## Solução de problemas

**`uranus doctor` diz que o `claude` falhou**
O CLI da Claude precisa de login próprio, separado do app desktop: rode `claude /login`. Se ele não
estiver no PATH, o Uranus procura automaticamente em `~/.local/bin` e `%APPDATA%/npm`. Para outro
caminho, configure `providers.entries.claude-code.binary`.

**A task ficou bloqueada**
`uranus task list` mostra o motivo entre colchetes. Os casos mais comuns são: as tentativas se
esgotaram (veja `uranus logs` para o diagnóstico e considere reescrever o pedido com mais
precisão), o orçamento é insuficiente (aumente `budget.perTask.usd` ou reduza o escopo), ou houve
um problema do próprio provedor, como autenticação, rede ou limite de uso.

Depois de resolver, use `uranus task retry <taskId>`.

**"Não há mais tasks executáveis" mesmo com tasks na fila**
Alguma política do escalonador está impedindo. `uranus task why <taskId>` mostra qual.

**O plano é sempre rejeitado**
As mensagens de rejeição são objetivas, vale a pena ler com atenção. As causas mais comuns são um
escopo grande demais, um contrato de aceite que só verifica o diff sem provar comportamento
nenhum, ou pedir um runner de testes que o projeto não tem. Melhorar a descrição do item de
backlog costuma resolver.

**"Push falhou; commit permanece local"**
O repositório não tem um remote configurado, ou o `gh` não está autenticado. O trabalho continua
seguro na branch `uranus/...`: use `git log uranus/<branch>` e `git diff main..uranus/<branch>`
para ver o que foi feito.

**Modo restrito: só aceita tasks de teste**
Seu projeto não tem sinal de verificação suficiente (`uranus context show` mostra a pontuação).
Isso é proposital: sem testes, não há como provar que o código funciona, e o Uranus viraria só um
gerador de código não verificado. Deixe primeiro o agente `testing` construir essa base.

---

## Desenvolvendo o próprio framework

```bash
pnpm install
pnpm check
pnpm coverage
```

Existe um teste de caos obrigatório no CI: ele mata o kernel em cada uma das fases do ciclo e prova
que retomar com `--resume` sempre conclui a task sem duplicar commit, sem deixar ambiente órfão e
sem travar nenhuma permissão.

### Pacotes do monorepo

| Pacote | Responsabilidade |
| --- | --- |
| `@uranus/core` | Tipos, contratos e domínio. A raiz de tudo, sem operações de entrada e saída. |
| `@uranus/config` | Configuração em camadas, com validação de schema. |
| `@uranus/events` | Barramento de eventos e o log persistente em arquivo. |
| `@uranus/state` | Banco de dados, migrações, repositórios e permissões com prazo. |
| `@uranus/executors` | Execução de comandos, ambiente isolado, verificação e diagnóstico. |
| `@uranus/vcs` | Integração com git e com o GitHub. |
| `@uranus/queue` | Fila persistente com proteção de arquivo e dependências entre tasks. |
| `@uranus/scheduler` | As 14 políticas de priorização, com explicação auditável. |
| `@uranus/backlog` | Backlog e validação determinística de planos. |
| `@uranus/context` | Resumo automático do projeto, dentro de um orçamento de tokens. |
| `@uranus/memory` | Memória em Markdown, com atualização e invalidação automáticas. |
| `@uranus/prompts` | Templates de prompt versionados. |
| `@uranus/providers` | Claude Code, provedores compatíveis com a API da OpenAI, roteamento. |
| `@uranus/agents` | O motor que executa agentes e o catálogo declarativo. |
| `@uranus/plugins` | Carregador de plugins, SDK e os plugins node, nextjs e docker. |
| `@uranus/telemetry` | Métricas, preços versionados, custo real e estado ao vivo. |
| `@uranus/dashboard` | Servidor do painel web: eventos em tempo real e fila de aprovações. |
| `@uranus/kernel` | O ciclo principal, planejamento, qualidade e recuperação. |
| `@uranus/cli` | A interface de linha de comando. |

### Documentação

* [Arquitetura](docs/00-ARCHITECTURE.md)
* [Contratos](docs/01-CONTRACTS.md)
* [Roadmap](docs/02-ROADMAP.md)
* [Árvore do projeto](docs/03-TREE.md)
* [Riscos](docs/04-RISKS.md)

### Roadmap

As fases 1 a 8 estão concluídas. A fase 9 (escala e robustez) está em andamento: paralelismo real,
limpeza de eventos e compactação de memória em escala já foram entregues e testados. Falta a
validação de campo, um teste real de 8 horas contra um provedor pago com 3 projetos rodando como
processos separados, antes de chegar na versão 1.0. Detalhes em
[docs/02-ROADMAP.md](docs/02-ROADMAP.md#fase-9--escala--hardening-10).

---

## Licença

Apache 2.0
