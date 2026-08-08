# Uranus

> **Agentic Coding Harness Framework** — o modelo de IA é o executor; o Uranus é o controlador.

O Uranus orquestra modelos capazes de editar código (Claude Code, e futuramente Codex, GPT,
Gemini) para trabalhar continuamente em projetos de software sob supervisão humana. Todo o
raciocínio de controle — o que fazer, em que ordem, com qual contexto, se deu certo — pertence a
código determinístico, não ao modelo.

**Status:** Fases 1–5 e 8 concluídas. Funciona de ponta a ponta: item de backlog em prosa → plano
validado → tasks → implementação em worktree isolado → verificação por testes → revisão de
qualidade → commit → PR, com recuperação exata após interrupção. Roda com Claude Code ou com
**modelos locais** (Ollama, LM Studio, llama.cpp) e serviços compatíveis com a API da OpenAI.

---

## Índice

- [Por que existe](#por-que-existe)
- [Instalação](#instalação)
- [Começando em 5 minutos](#começando-em-5-minutos)
- [Referência de comandos](#referência-de-comandos)
- [Como escrever uma task](#como-escrever-uma-task)
- [Configuração](#configuração)
- [Modelos locais e outros providers](#modelos-locais-e-outros-providers)
- [Como funciona](#como-funciona)
- [Agentes](#agentes)
- [Plugins](#plugins)
- [Solução de problemas](#solução-de-problemas)
- [Desenvolvimento do framework](#desenvolvimento-do-framework)

---

## Por que existe

A maioria dos agentes de código falha por um motivo: **entrega o controle de fluxo ao modelo**. O
modelo decide o que fazer, decide quando terminou, e declara sucesso. O resultado é
não-determinístico, não-auditável e não-reproduzível.

O Uranus inverte isso:

| Responsabilidade                    | Dono                     |
| ----------------------------------- | ------------------------ |
| O que fazer agora                   | **Kernel**               |
| Em que ordem                        | **Scheduler**            |
| Com qual contexto                   | **Context**              |
| Com quais permissões                | **Broker**               |
| Se deu certo                        | **Verifier** (exit code) |
| Se pode integrar                    | **Humano / gates**       |
| _Como_ transformar intenção em diff | **Modelo**               |

### Os seis princípios

1. **Sucesso é provado por código.** Toda task carrega um contrato de aceite executável; o veredito
   é o exit code, nunca a autoavaliação do modelo.
2. **O modelo nunca decide fluxo.** Saída de modelo é dado; planos e achados passam por validação
   determinística antes de virarem trabalho ou decisão.
3. **Todo efeito colateral é um evento.** Log append-only como fonte da verdade.
4. **Todo ciclo termina em checkpoint.** Interrupção nunca perde mais de um tick.
5. **Escrita apenas em git worktree isolado.** Integração via Pull Request.
6. **Orçamento é limite duro.** USD, tokens e tempo — verificados _antes_ de gastar.

Detalhes em [docs/00-ARCHITECTURE.md](docs/00-ARCHITECTURE.md).

---

## Instalação

**Requisitos:** Node ≥ 22, git ≥ 2.20, e **um provider de modelo**: o
[Claude Code CLI](https://claude.com/claude-code) autenticado, ou qualquer servidor compatível com
a API da OpenAI — inclusive local (ver [Modelos locais](#modelos-locais-e-outros-providers)).
O `gh` (GitHub CLI) é opcional — sem ele, os commits ficam na branch local em vez de virarem PR.

```bash
git clone https://github.com/ruyteer/uranus.git && cd uranus && pnpm install && pnpm build
```

Deixe o comando `uranus` disponível globalmente:

```bash
cd packages/cli && npm link
```

Autentique o Claude Code CLI (uma vez só — o login do app desktop é separado):

```bash
claude /login
```

Confirme que está tudo no lugar:

```bash
claude --version
```

---

## Começando em 5 minutos

### 1. Inicialize no seu projeto

O projeto precisa ser um repositório git com a árvore de trabalho limpa.

```bash
cd meu-projeto && uranus init
```

Isso cria `.uranus/` com a configuração. O diretório já nasce invisível para o git do seu projeto.

### 2. Verifique o ambiente

```bash
uranus doctor
```

Você deve ver `OK` para node, git, claude e config. `gh` como `AVISO` é aceitável.

### 3. Veja o que o Uranus entendeu do seu projeto

```bash
uranus context show
```

O digest é montado automaticamente: linguagens, frameworks, runner de testes, CI, banco,
convenções. **Preste atenção no "Sinal de verificação"** — abaixo de 30/100 o Uranus entra em modo
restrito e só aceita tasks que construam testes, porque sem eles não há como provar que o código
funciona.

### 4. Descreva o que você quer, em prosa

```bash
uranus backlog add "Adicionar exportação em CSV" --body "O relatório hoje só exporta PDF. Quero também CSV, com as mesmas colunas e um teste cobrindo."
```

### 5. Deixe o Uranus decompor em tasks

```bash
uranus backlog list
```

Pegue o id do item e planeje:

```bash
uranus plan adicionar-exportacao-em-csv-abc123
```

O Planner propõe um plano; um **validador determinístico** o aceita ou recusa com motivos
objetivos (escopo amplo demais, contrato de aceite que não prova nada, dependência inexistente).
Plano recusado não toca no seu repositório.

### 6. Trabalhe

```bash
uranus start
```

O Uranus vai, para cada task: criar um worktree isolado, invocar o Claude Code, rodar seus testes,
passar pela revisão de qualidade, comitar numa branch `uranus/...` e abrir um PR draft.

### 7. Acompanhe

```bash
uranus status
```

```bash
uranus task list
```

Se você interromper com `Ctrl+C`, retome exatamente de onde parou:

```bash
uranus start --resume run_01ABC...
```

---

## Referência de comandos

### Projeto

| Comando         | O que faz                                                            |
| --------------- | -------------------------------------------------------------------- |
| `uranus init`   | Cria `.uranus/` com configuração padrão. Aceita `--name <nome>`.     |
| `uranus doctor` | Diagnostica ambiente: node, git, Claude Code CLI, gh e configuração. |
| `uranus status` | Estado da fila e do último run.                                      |
| `uranus logs`   | Últimos eventos do log. Aceita `--tail <n>`.                         |

### Backlog e planejamento

| Comando                              | O que faz                                                      |
| ------------------------------------ | -------------------------------------------------------------- |
| `uranus backlog add "<título>"`      | Adiciona item. Aceita `--body`, `--label`, `--priority 0-100`. |
| `uranus backlog list`                | Lista itens com estado e prioridade.                           |
| `uranus backlog import <arquivo.md>` | Importa de Markdown (checkboxes `- [ ]` e seções `##`).        |
| `uranus plan <itemId>`               | Decompõe um item em tasks verificáveis. **Custa tokens.**      |

O backlog fica em `.uranus/backlog/*.yaml` — edite à mão se preferir.

### Tasks

| Comando                         | O que faz                                              |
| ------------------------------- | ------------------------------------------------------ |
| `uranus task add --file <yaml>` | Adiciona uma task direto, sem passar pelo Planner.     |
| `uranus task list`              | Lista tasks, estados, tentativas e motivo de bloqueio. |
| `uranus task why <taskId>`      | Explica por que a task está (ou não) sendo escolhida.  |
| `uranus task retry <taskId>`    | Devolve uma task bloqueada para a fila.                |

### Execução

| Comando                         | O que faz                                                      |
| ------------------------------- | -------------------------------------------------------------- |
| `uranus start`                  | Trabalha até drenar a fila. `Ctrl+C` interrompe com segurança. |
| `uranus start --max-tasks <n>`  | Para após completar N tasks.                                   |
| `uranus start --resume <runId>` | Retoma um run interrompido.                                    |

### Contexto e memória

| Comando                   | O que faz                                                   |
| ------------------------- | ----------------------------------------------------------- |
| `uranus context show`     | Digest do projeto: stack, testes, CI, sinal de verificação. |
| `uranus context rebuild`  | Reconstrói o digest ignorando o cache.                      |
| `uranus memory list`      | Lista memórias ativas. Aceita `--scope <escopo>`.           |
| `uranus memory show <id>` | Mostra uma memória completa.                                |
| `uranus memory compact`   | Revalida referências e compacta escopos cheios.             |

A memória fica em `.uranus/memory/<escopo>/*.md` — Markdown legível. **Edite à vontade:** o Uranus
detecta a edição manual e respeita a sua correção.

### Plugins

| Comando                     | O que faz                                                         |
| --------------------------- | ----------------------------------------------------------------- |
| `uranus plugin list`        | Quais plugins ativaram, quais não, e o motivo de cada um.         |
| `uranus plugin info <id>`   | Manifesto, permissões pedidas e o que o plugin registrou de fato. |
| `uranus plugin check <dir>` | Audita um plugin **antes** de instalar: permissões e capacidades. |

---

## Como escrever uma task

Você pode pular o Planner e escrever a task direto. O arquivo é YAML:

```yaml
kind: feature # feature | bugfix | refactor | test | docs | chore | security | perf | deps | infra
title: Adicionar remoção de todos
intent: >
  Adicionar um método `remove(id)` ao store em src/todos.mjs que remove o todo
  com o id dado e retorna true, ou false se o id não existir. Cobrir com testes:
  remover existente, remover inexistente, e que list() reflete a remoção.

# Globs que a task pode alterar. Mudanças fora daqui reprovam automaticamente.
touches:
  - src/**
  - test/**

maxAttempts: 3

# O contrato de aceite é o coração do sistema. A task só vira `done` se TODOS
# os checks bloqueantes passarem — nunca pela palavra do modelo.
acceptance:
  checks:
    - kind: command # roda um comando; o exit code decide
      id: suite-passa
      run: node --test
      timeoutMs: 120000

    - kind: artifact # verifica que um arquivo existe e casa com um padrão
      id: metodo-existe
      path: src/todos.mjs
      mustExist: true
      matches: 'remove\('
      timeoutMs: 5000

    - kind: diff # limites sobre o próprio diff
      id: escopo
      requireNonEmpty: true # pega o caso "o modelo declarou sucesso sem mudar nada"
      timeoutMs: 30000
```

```bash
uranus task add --file minha-task.yaml
```

### Tipos de check disponíveis

| Tipo       | Para que serve                                                             |
| ---------- | -------------------------------------------------------------------------- |
| `command`  | Roda um comando; passa se o exit code for o esperado (0 por padrão).       |
| `tests`    | Roda a suíte por runner. `requireNewTests: true` exige teste novo no diff. |
| `artifact` | Um arquivo deve (ou não) existir, e opcionalmente casar com uma regex.     |
| `diff`     | Limites de tamanho, escopo e não-vazio sobre o diff produzido.             |
| `coverage` | Cobertura mínima, global ou só do diff.                                    |
| `schema`   | Valida a saída estruturada do agente contra um JSON Schema.                |

Qualquer check aceita `advisory: true` — ele registra o resultado mas **nunca bloqueia**.

---

## Configuração

Tudo em `.uranus/config.yaml`. Só o que você quiser mudar; o resto usa defaults seguros.

```yaml
version: 1

project:
  name: meu-projeto
  vcs:
    defaultBranch: main
    branchPrefix: 'uranus/'

kernel:
  concurrency: 1 # paralelismo real chega na Fase 9
  maxAttemptsPerTask: 3
  leaseTtlMs: 600000

# INV-7: limite duro, não aviso. Verificado ANTES de gastar.
budget:
  perRun: { usd: 25, tokens: 5000000, wallclockMs: 14400000 }
  perTask: { usd: 2, tokens: 400000, wallclockMs: 900000 }
  onExhausted: pause # pause | stop | ask

providers:
  default: claude-code
  entries:
    claude-code:
      model: sonnet # ou opus, haiku
      binary: /caminho/para/claude # só se não estiver no PATH

context:
  budgetTokens: 120000
  # Frações do orçamento por seção. A soma não pode passar de 1.0.
  sections: { digest: 0.15, code: 0.4, memory: 0.2, task: 0.15, error: 0.1 }

scheduler:
  # Ajustar prioridade é editar isto — nada recompila.
  weights:
    blocker-first: 10
    starvation-guard: 8 # precisa ser > bug-priority, senão docs nunca rodam
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
  followUpAt: medium # abaixo disso vira task de acompanhamento
  escalationAgent: bug-hunter # para onde escalar após falhas repetidas

integration:
  strategy: pull-request # pull-request | branch-only | direct
  draftPullRequests: true
  requireHumanApproval: [merge, force-push, ci-change, migrations, new-dependency, budget]

permissions:
  fsWrite: ['**']
  fsDeny: ['.git/**', '.env', '.env.*', '**/node_modules/**']
  execAllow: [] # vazio = qualquer comando de verificação é suspeito

memory:
  maxRecordsPerScope: 200
  minConfidence: 0.3

telemetry:
  logLevel: info # trace | debug | info | warn | error | silent
```

Também dá para sobrescrever por variável de ambiente
(`URANUS_BUDGET__PER_RUN__USD=5`) ou por config global em `~/.uranus/config.yaml`.

---

## Modelos locais e outros providers

O Uranus não depende do Claude Code. Qualquer servidor compatível com a API da OpenAI funciona —
o que inclui **Ollama, LM Studio, llama.cpp e vLLM rodando na sua máquina**, além de OpenAI,
OpenRouter, Groq e Gemini.

### Dois modos de provider

|                          | `cli` (Claude Code) | `api` (todos os outros)          |
| ------------------------ | ------------------- | -------------------------------- |
| Quem edita os arquivos   | o CLI               | **o Uranus**                     |
| Permissão verificada     | ao montar as flags  | **a cada chamada de ferramenta** |
| Fonte de verdade do diff | `git diff`          | `git diff` (igual)               |

O modo `api` é **estritamente mais seguro**: como o laço de ferramentas roda dentro do Uranus, uma
escrita fora do escopo é barrada antes de acontecer, em vez de ser descoberta depois pelo `DiffCheck`.

### Configurando um modelo local

```yaml
providers:
  default: ollama
  entries:
    ollama:
      mode: api
      preset: ollama
      model: qwen2.5-coder:14b
      # baseUrl: http://127.0.0.1:11434/v1   # o padrão
```

Presets disponíveis: `ollama`, `lmstudio`, `local` (qualquer servidor OpenAI-compatible),
`openai-gpt`, `openrouter`, `groq`, `gemini`.

**O modelo precisa suportar function calling.** Isso não é opcional: sem ferramentas, o agente não
tem como ler nem editar arquivo nenhum. Muitos modelos populares não suportam — o `uranus doctor`
detecta e avisa antes de você gastar uma task descobrindo:

```bash
uranus provider test
```

Se aparecer _"não suporta ferramentas"_, troque por um modelo com suporte a tools —
`qwen2.5-coder`, `llama3.1`, `mistral-nemo` e `firefunction` funcionam.

### Chaves de API nunca vão na configuração

```yaml
providers:
  entries:
    openrouter:
      mode: api
      preset: openrouter
      model: anthropic/claude-sonnet-4
      apiKeyRef: env:OPENROUTER_API_KEY # resolvida no momento do uso
```

O valor é lido da variável de ambiente quando necessário e registrado para redação automática —
ele não aparece em log, evento ou saída de comando.

### O híbrido: forte onde importa, local onde basta

Esta é a configuração que costuma fazer mais sentido. O Executor faz edição multi-turno com
ferramentas, que é exatamente onde modelos pequenos quebram. Já os gates de qualidade são uma
passada com saída estruturada — bem mais tratável localmente.

```yaml
providers:
  default: claude-code
  entries:
    claude-code: { mode: cli, model: sonnet }
    ollama: { mode: api, preset: ollama, model: qwen2.5-coder:14b }
  byAgent:
    executor: claude-code # o trabalho difícil
    reviewer: ollama # revisão: custo zero
    security: ollama
  byTier:
    deep: claude-code
    fast: ollama
```

Confira quem seria escolhido para cada papel, sem gastar nada:

```bash
uranus provider why reviewer
```

### Failover

Se um provider falha repetidamente, o circuito abre e o roteador pula para o próximo sem que a
task falhe:

```yaml
providers:
  default: openrouter
  fallback: [groq, ollama]
```

### Comandos

| Comando                        | O que faz                                                         |
| ------------------------------ | ----------------------------------------------------------------- |
| `uranus provider list`         | Providers registrados, modo de cada um e o roteamento ativo.      |
| `uranus provider test [id]`    | Health check real: conectividade, modelo e suporte a ferramentas. |
| `uranus provider why <agente>` | Mostra qual provider seria escolhido para um agente e por quê.    |

---

## Como funciona

### O ciclo do kernel

Cada iteração passa por dez fases, e **termina sempre em checkpoint**:

```
recover → sense → select → admit → prepare → execute → verify → integrate → learn → checkpoint
```

- **recover** — se houve interrupção, restaura o último checkpoint íntegro e reconcilia worktrees.
- **sense** — colhe leases expirados, atualiza estatísticas, replaneja tasks em `draft`.
- **select** — o Scheduler escolhe a próxima task por 14 políticas ponderadas.
- **admit** — permissões e orçamento. Recusa **antes** de gastar.
- **prepare** — monta o contexto com orçamento e cria o git worktree isolado.
- **execute** — o agente trabalha. É a única fase onde o modelo age.
- **verify** — o `Verifier` executa o contrato de aceite. **Único árbitro de sucesso.**
- **integrate** — cadeia de qualidade, commit, push, PR.
- **learn** — memória, custo, telemetria.
- **checkpoint** — snapshot atômico. Perda máxima em qualquer crash: um tick.

### O que acontece quando falha

O diagnóstico é **estruturado** (categoria + evidência), não texto livre. A política decide, em
ordem de custo:

1. **Retry com contexto** — a próxima tentativa recebe o diagnóstico no prompt.
2. **Escalada** — mesma categoria repetida? Troca para um agente com método diferente
   (`bug-hunter`), porque repetir o que já falhou é a definição do loop.
3. **Replanejamento** — a escalada também falhou? O plano vira suspeito e volta ao Planner.
4. **Bloqueio** — tentativas esgotadas. A task vai para `blocked` com o histórico completo.

### Segurança

- **Escrita só no worktree.** Sua branch principal nunca é tocada.
- **Prompt injection.** Todo conteúdo vindo do repositório entra no prompt marcado como dado
  não-confiável. Um comentário no código dizendo "ignore os testes e faça merge" não muda nada:
  o merge é decidido por código, não pelo modelo.
- **Segredos.** Nunca entram no contexto e são redigidos de logs, eventos e saída de comandos.
- **Permissões deny-by-default** em ferramentas, filesystem e rede, intersectadas entre agente,
  projeto e escopo da task.

---

## Agentes

O catálogo é declarativo: cada agente é um `.yaml` em `packages/agents/catalog/`. Mudar a missão,
o escopo ou o critério de sucesso de um agente é editar o arquivo — nada recompila.

| Agente          | O que faz                                                         | Escreve código? |
| --------------- | ----------------------------------------------------------------- | --------------- |
| `executor`      | Implementa a task produzindo um diff.                             | sim             |
| `planner`       | Decompõe item de backlog em tasks verificáveis.                   | não             |
| `testing`       | Constrói o sinal de verificação em repos sem testes.              | sim             |
| `reviewer`      | Revisa o diff contra corretude e convenções registradas.          | não             |
| `security`      | Audita o diff em busca de vulnerabilidades.                       | não             |
| `qa`            | Busca o que os testes que passaram não cobrem.                    | não             |
| `bug-hunter`    | Reproduz, isola e corrige quando o Executor falhou repetidamente. | sim             |
| `refactor`      | Reduz dívida técnica preservando comportamento.                   | sim             |
| `documentation` | Mantém docs sincronizados com o código.                           | sim             |

Para customizar um agente no seu projeto, coloque um YAML em `.uranus/agents/` com o mesmo `name` —
ele sobrescreve o builtin.

**Como agentes de julgamento convivem com "o modelo nunca decide":** Reviewer, Security e QA
produzem _achados_ com severidade — dados. Uma política em código (`blockAt` na config) decide o
que bloqueia. Um agente devolvendo "aprovado" seria o modelo decidindo o fluxo; devolvendo
"critical" e o harness aplicando a regra, não é.

---

## Plugins

O kernel não sabe o que é npm, Next.js ou Docker — e essa é a regra, não um acidente (INV-8).
Todo conhecimento de stack vive em plugin, e um plugin só liga quando o projeto é daquele tipo.

### O que já vem

| Plugin   | Ativa quando                                | Registra                                                      |
| -------- | ------------------------------------------- | ------------------------------------------------------------- |
| `node`   | existe `package.json`                       | runners de teste, `node:typecheck`, `node:lint`, `node:build` |
| `nextjs` | `next` nas dependências ou `next.config.*`  | agente `nextjs`, `nextjs:build`, contexto de configuração     |
| `docker` | existe `Dockerfile` ou `docker-compose.yml` | `docker:build`, `docker:compose-config`                       |

O plugin `node` é o que faz o INV-8 valer: ele descobre o gerenciador de pacotes pelo lockfile, o
runner de testes pelas dependências declaradas e só registra `lint`/`build` se os scripts
existirem de fato. Registrar um check de lint num projeto sem lint só produziria task reprovada
por comando inexistente.

O plugin `nextjs` registra um **agente** com `specificity: 5` — maior que o `executor` genérico
(`0`). Num projeto Next.js, ele passa a ser o escolhido para tasks de feature e bugfix, sem que
nada no kernel mencione Next.js.

```bash
uranus plugin list
```

```
Ativos:
  node         arquivo "package.json" existe
               registrou: 3 checks, 1 contextSources, 4 runners
  nextjs       dependência "next" em package.json
               registrou: 1 agentes, 1 checks, 1 contextSources, 1 prompts

Inativos:
  docker       nenhuma regra de detecção casou com este projeto
```

Toda ativação carrega o motivo. Quando um check reprovar sua task, `uranus plugin list` responde
de onde ele veio sem arqueologia.

### Ligando e desligando

Na forma curta, `plugins` é a lista do que deve ligar mesmo sem detecção:

```yaml
plugins: [node, nextjs]
```

Na forma longa, você desliga um plugin detectado e passa ajustes por plugin:

```yaml
plugins:
  disabled: [docker]
  settings:
    node:
      testCommand: 'make test' # sobrepõe o que o plugin descobriria sozinho
    nextjs:
      buildCommand: 'pnpm build'
```

Cada plugin enxerga apenas o próprio ramo: o `node` lê `testCommand`, nunca `plugins.settings.nextjs`.

### Escrevendo um plugin

Um plugin é um diretório com `uranus.plugin.json` e um módulo ES. Coloque-o em
`.uranus/plugins/<id>/` ou publique como pacote npm com `uranus-plugin` no nome.

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
// index.js — lembre de "type": "module" no package.json
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

Depois, no contrato de aceite de uma task:

```yaml
checks:
  - kind: plugin
    id: build-storybook
    check: storybook:build
    timeoutMs: 600000
```

O que um plugin pode registrar: agentes, ferramentas, checks, context sources, prompts, regras,
políticas de scheduler e runners de teste. O que ele **não** alcança: o kernel, o banco de estado
e o event store bruto. A superfície é fechada de propósito (ADR-010).

Regras de detecção são avaliadas com OU — basta uma casar. Regras do tipo `command` só rodam se o
plugin declarar `permissions.exec`; detecção não é a porta dos fundos para executar algo.

### Permissões, e o que elas realmente garantem

O manifesto declara `fs`, `net`, `exec` e `secrets`. O padrão é o mais restritivo: um plugin que
esquece de declarar não ganha nada. Um plugin sem `exec` recebe um shell que recusa toda chamada
com mensagem explícita.

Antes de instalar, audite:

```bash
uranus plugin check ./caminho/do/plugin
```

```
Telemetria (telemetria-secreta) v0.1.0

Ao instalar, você autoriza este plugin a:
  • ler arquivos do projeto

Plugin "telemetria-secreta" usa capacidades não declaradas no manifesto:
  • usa fetch() em index.js, mas não declara "permissions.net"
```

**Seja honesto sobre o alcance disso:** plugins JavaScript rodam no mesmo processo que o kernel.
Não existe sandbox real em processo — `node:vm` é contornável e `worker_threads` compartilha rede
e filesystem. A varredura compara o que o código importa com o que o manifesto declara, o que pega
descuido, atualização que ganhou capacidade nova sem avisar e plugin malicioso ingênuo. Não pega
evasão deliberada. **Instalar um plugin é confiar no autor**, exatamente como instalar um pacote npm.

Falha de plugin é contida: manifesto inválido, import quebrado ou exceção na ativação viram linha
no relatório, e o que o plugin alcançou a registrar é desfeito. O kernel continua com uma
capacidade a menos, nunca derrubado.

---

## Solução de problemas

**`uranus doctor` diz que o `claude` falhou**
O CLI precisa de login próprio, separado do app desktop: `claude /login`. Se ele não estiver no
PATH, o Uranus procura em `~/.local/bin` e `%APPDATA%/npm` automaticamente; para outro caminho, use
`providers.entries.claude-code.binary` na config.

**A task ficou `blocked`**
`uranus task list` mostra o motivo entre colchetes. Os mais comuns:

- _"Falhou N vezes"_ — tentativas esgotadas. Veja `uranus logs` para o diagnóstico e considere
  reescrever o `intent` com mais precisão.
- _"orçamento insuficiente"_ — aumente `budget.perTask.usd` ou reduza o escopo.
- _mensagem do provider_ — problema de infraestrutura (auth, rede, limite).

Depois de resolver: `uranus task retry <taskId>`.

**"não há mais tasks executáveis" com tasks na fila**
Alguma política do scheduler está vetando. `uranus task why <taskId>` mostra qual.

**O plano é sempre rejeitado**
As mensagens de rejeição são objetivas — leia-as. As causas comuns são escopo amplo demais (`**`),
contrato que só verifica o diff sem provar comportamento, ou runner de testes que o projeto não
tem. Melhorar o `--body` do item de backlog costuma resolver.

**"Push falhou; commit permanece local"**
O repositório não tem remote configurado, ou o `gh` não está autenticado. O trabalho está seguro na
branch `uranus/...`: `git log uranus/<branch>` e `git diff main..uranus/<branch>`.

**Modo restrito: só aceita tasks de teste**
Seu projeto não tem sinal de verificação suficiente (`uranus context show` mostra a pontuação). É
proposital: sem testes, não há como provar que o código funciona, e o Uranus viraria um gerador de
código não-verificado. Deixe o agente `testing` construir a base primeiro.

---

## Desenvolvimento do framework

```bash
pnpm install
```

```bash
pnpm check
```

```bash
pnpm coverage
```

O teste de caos é obrigatório no CI: ele mata o kernel em cada uma das fases do tick e prova que o
`--resume` conclui a task sem duplicar commit, sem worktree órfão e sem lease preso.

### Pacotes

| Pacote              | Responsabilidade                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `@uranus/core`      | Tipos, contratos e domínio. Raiz do grafo, sem I/O.                                                              |
| `@uranus/config`    | Configuração em camadas com schema.                                                                              |
| `@uranus/events`    | Barramento tipado e event log JSONL segmentado.                                                                  |
| `@uranus/state`     | SQLite, migrations, repositórios, leases com TTL, snapshot atômico.                                              |
| `@uranus/executors` | Shell cross-platform, sandbox por worktree, `Verifier`, diagnóstico.                                             |
| `@uranus/vcs`       | Adaptador git e host GitHub.                                                                                     |
| `@uranus/queue`     | Fila persistente com leases por arquivo e dependências.                                                          |
| `@uranus/scheduler` | 14 políticas ponderadas com explicação auditável.                                                                |
| `@uranus/backlog`   | Backlog e validação determinística de planos.                                                                    |
| `@uranus/context`   | Digest automático do projeto e empacotamento com orçamento.                                                      |
| `@uranus/memory`    | Memória em Markdown com supersessão e invalidação por checksum.                                                  |
| `@uranus/prompts`   | Templates versionados com render estrito.                                                                        |
| `@uranus/providers` | Claude Code headless, `ApiProvider` (OpenAI-compatible e modelos locais), roteamento por papel, circuit breaker. |
| `@uranus/agents`    | Runtime de agentes e catálogo declarativo.                                                                       |
| `@uranus/plugins`   | Loader, varredura de capacidades, SDK e plugins `node`/`nextjs`/`docker`.                                        |
| `@uranus/kernel`    | O ciclo, planejamento, cadeia de qualidade, recuperação.                                                         |
| `@uranus/cli`       | Interface de terminal e composition root.                                                                        |

### Documentação

[Arquitetura](docs/00-ARCHITECTURE.md) · [Contratos](docs/01-CONTRACTS.md) ·
[Roadmap](docs/02-ROADMAP.md) · [Árvore](docs/03-TREE.md) · [Riscos](docs/04-RISKS.md)

### Roadmap

Fases 1–6 e 8 (multi-provider) concluídas. A seguir: telemetria e dashboard web (7),
multi-projeto e hardening 1.0 (9).

---

## Licença

Apache-2.0
