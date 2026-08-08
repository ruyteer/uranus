# Uranus — Arquitetura

> **Agentic Coding Harness Framework**
> O modelo de IA é o _executor_. O Uranus é o _controlador_.

Documento vivo. Versão `0.1.0-design`. Status: **aguardando aprovação para Fase 1**.

---

## 1. Tese central

A maioria dos "agentes de código" falha por um único motivo: **entregam o controle de fluxo ao modelo**.
O modelo decide o que fazer, decide quando terminou, e declara sucesso. O resultado é um sistema
não-determinístico, não-auditável e não-reproduzível.

O Uranus inverte isso:

| Responsabilidade                      | Dono                              |
| ------------------------------------- | --------------------------------- |
| O que fazer agora                     | **Kernel** (código)               |
| Em que ordem                          | **Scheduler** (código)            |
| Com qual contexto                     | **ContextManager** (código)       |
| Com quais permissões                  | **PermissionBroker** (código)     |
| Se deu certo                          | **Verifier** (código — exit code) |
| Se pode integrar                      | **Humano / Gate**                 |
| _Como_ transformar a intenção em diff | **Modelo**                        |

O modelo tem exatamente uma função: **transformar uma unidade de trabalho bem-especificada em um diff**.
Tudo o mais é engenharia de software convencional, determinística e testável.

### Invariantes do sistema

Estas regras não podem ser quebradas por nenhum módulo, plugin ou agente:

1. **INV-1 — Nenhuma decisão de controle de fluxo vem do modelo.** Saída de modelo é _dado_, nunca _comando_.
2. **INV-2 — Sucesso é provado por código.** Um `Task` só é `verified` se seu `AcceptanceContract` executou e passou. A opinião do modelo não conta.
3. **INV-3 — Todo efeito colateral é um evento.** Sem evento, não aconteceu.
4. **INV-4 — Todo ciclo termina em checkpoint.** Interrupção nunca perde mais do que um ciclo.
5. **INV-5 — Escrita apenas em workspace isolado.** Nunca na branch principal, nunca fora do sandbox.
6. **INV-6 — Conteúdo lido do repositório/issues/web é dado não-confiável.** Nunca é instrução (defesa contra prompt injection).
7. **INV-7 — Orçamento é limite duro.** Tokens, custo, tempo e tentativas param a execução, não avisam.
8. **INV-8 — O Kernel não conhece linguagens, frameworks ou ferramentas de build.** Isso é papel de plugins.

---

## 2. Visão macro

```
┌──────────────────────────────────────────────────────────────────────────┐
│  SUPERVISÃO HUMANA                                                       │
│  CLI  ·  Dashboard Web  ·  Approval Gates  ·  Pull Requests              │
└───────────────┬──────────────────────────────────────────────────────────┘
                │ comandos / aprovações            eventos / métricas ▲
                ▼                                                     │
┌──────────────────────────────────────────────────────────────────────────┐
│  KERNEL  (ciclo determinístico · sem regras de domínio)                  │
│                                                                          │
│   recover → sense → select → admit → prepare → execute → verify →        │
│   integrate → learn → checkpoint  ↺                                      │
│                                                                          │
│  ┌──────────┬──────────┬───────────┬───────────┬──────────┬───────────┐  │
│  │ Queue    │ Scheduler│ Permission│ Budget    │Checkpoint│ Recovery  │  │
│  │ Manager  │ (policy) │ Broker    │ Guard     │ Manager  │ Manager   │  │
│  └──────────┴──────────┴───────────┴───────────┴──────────┴───────────┘  │
└───┬───────────┬───────────┬────────────┬────────────┬───────────┬────────┘
    │           │           │            │            │           │
    ▼           ▼           ▼            ▼            ▼           ▼
┌────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐ ┌─────────┐ ┌──────────┐
│ Agents │ │ Context │ │ Memory  │ │ Executors│ │Providers│ │ Plugins  │
│runtime │ │ Manager │ │ Store   │ │ +Sandbox │ │  layer  │ │ registry │
│+catálogo│ │ +packer │ │+índice  │ │+Verifier │ │         │ │          │
└────────┘ └─────────┘ └─────────┘ └────┬─────┘ └────┬────┘ └──────────┘
                                        │            │
                                        ▼            ▼
                                 ┌────────────┐ ┌──────────────────────┐
                                 │ git worktree│ │ claude-code · codex  │
                                 │ shell · fs  │ │ gpt · gemini · orouter│
                                 └────────────┘ └──────────────────────┘

  ═══ EVENT BUS (append-only, fonte da verdade) ═══════════════════════════
  ═══ STATE STORE (SQLite/WAL: tasks, runs, checkpoints, métricas) ════════
```

### Fluxo de uma tarefa (caminho feliz)

```
BacklogItem ──Planner──▶ Plan ──validador──▶ Task[] ──Scheduler──▶ Task
     │                                                               │
     │                                                    PermissionBroker + BudgetGuard
     │                                                               ▼
     │                                              ContextManager ── ContextPack
     │                                                               ▼
     │                                              Sandbox ── git worktree isolado
     │                                                               ▼
     │                                              Provider ── sessão do modelo
     │                                                               ▼
     │                                              Verifier ── testes/lint/tipos (exit code)
     │                                              ┌────────────────┴───────┐
     │                                          PASSOU                   FALHOU
     │                                              ▼                        ▼
     │                                    commit + PR + memória      diagnóstico ──▶ retry
     │                                              ▼                        │ (N vezes)
     └────────────────────────────────────── evento + checkpoint             ▼
                                                                        replanejar
                                                                        ou escalar
```

---

## 3. Decisões de arquitetura (ADRs resumidos)

### ADR-001 — Linguagem: TypeScript (Node ≥ 22), monorepo pnpm

**Decisão:** TypeScript estrito, ESM, monorepo pnpm workspaces.

**Por quê:**

- Os providers-alvo (Claude Code, Codex CLI, Gemini CLI) são distribuídos como CLIs Node e SDKs TS de primeira classe.
- Contratos tipados end-to-end: kernel → plugin → dashboard compartilham os mesmos tipos, sem duplicação nem geração de schema.
- Ecossistema de plugins via npm resolve distribuição, versionamento e resolução de dependências de graça.
- O dashboard é web; usar a mesma linguagem elimina uma fronteira inteira.

**Alternativas rejeitadas:**

- _Python_ — melhor para embeddings/ML, pior para CLI distribuível, tipagem mais fraca nos contratos, duas linguagens no projeto.
- _Go/Rust_ — excelente para o kernel, mas isola o ecossistema de plugins e o dashboard; ganho de performance é irrelevante num sistema I/O-bound dominado por latência de LLM.

**Consequência:** embeddings ficam via API (OpenAI/Voyage/local `fastembed`), não em processo.

---

### ADR-002 — Kernel determinístico; modelo como executor puro

**Decisão:** O kernel nunca pergunta "o que devo fazer agora?" ao modelo. Ele pergunta
"execute _esta_ unidade de trabalho, com _estas_ ferramentas, satisfazendo _este_ critério".

**Exceção controlada:** o agente `Planner` produz **dados estruturados** (um `Plan` validado contra
JSON Schema), não controle. O plano passa por um validador determinístico (ciclos, dependências,
escopo, tamanho, paths permitidos) antes de virar `Task[]`. Um plano inválido é rejeitado sem
jamais tocar o repositório.

**Consequência:** o sistema é reproduzível dado (estado + seeds + versões de provider). Falhas são
depuráveis. Nenhum prompt gigante concentra lógica.

---

### ADR-003 — Verificação por código, nunca autoavaliação

**Decisão:** Todo `Task` carrega um `AcceptanceContract` composto de _checks executáveis_
(comando, suíte de testes, cobertura de diff, limites de diff, artefato existente, schema de saída).
O veredito é o exit code.

**Por quê:** este é o único mecanismo que quebra o modo de falha dominante — o modelo declarar
sucesso sobre trabalho incompleto. Sem isso, todo o resto é teatro.

**Consequência:** o Uranus **não funciona bem em projetos sem sinal de verificação**. Por isso a
Fase 2 inclui um agente `Testing` cuja primeira missão em um repo novo é _criar_ o sinal
(smoke tests, typecheck, lint) antes de qualquer feature. "TDD First" é uma restrição arquitetural,
não um slogan.

**Nota:** _LLM-as-judge_ existe apenas como check **consultivo** (`advisory: true`), nunca bloqueante.

---

### ADR-004 — Persistência dupla: SQLite quente + arquivos frios versionáveis

**Decisão:**

| Camada            | Tecnologia                                  | Conteúdo                                                           |
| ----------------- | ------------------------------------------- | ------------------------------------------------------------------ |
| Estado quente     | SQLite (WAL, `better-sqlite3`)              | tasks, runs, fila, eventos indexados, checkpoints, métricas, locks |
| Log de eventos    | JSONL segmentado + índice SQLite            | fonte da verdade append-only                                       |
| Memória semântica | Markdown + frontmatter em `.uranus/memory/` | arquitetura, decisões, convenções, bugs conhecidos                 |
| Índice de memória | SQLite FTS5 + `sqlite-vec` (opcional)       | busca lexical + semântica                                          |

**Por quê:** a memória precisa ser **legível, editável e revisável por humanos** e **versionável em git**
— um banco binário opaco mata a supervisão humana. Já a fila e o estado precisam de ACID e consultas,
que arquivos não dão. Cada camada usa a tecnologia certa.

**Consequência:** `.uranus/memory/` é commitável; `.uranus/state.db`, `runs/` e `workspaces/` vão no `.gitignore`.

---

### ADR-005 — Isolamento por git worktree, integração PR-only

**Decisão:** Cada `Task` executa em um `git worktree` dedicado com branch própria
(`uranus/<taskId>-<slug>`). O Uranus nunca escreve na working tree principal e nunca faz merge
na branch default por padrão.

**Por quê:** paralelismo seguro, rollback trivial (`worktree remove`), revisão humana natural via PR,
e falha contida — um agente que destrói tudo destrói apenas seu worktree.

**Consequência:** exige `git` ≥ 2.20 e repositório limpo. Modo `--no-vcs` existe para experimentação,
com aviso explícito.

---

### ADR-006 — Event sourcing pragmático

**Decisão:** O log de eventos é a fonte da verdade. O estado em SQLite é uma **projeção** derivada.
Checkpoint = snapshot da projeção + offset do log. Recovery = carregar snapshot + reprocessar a cauda.

**Por quê:** dá auditoria completa, replay, debugging temporal e recuperação exata — os quatro
requisitos que "trabalhar por horas sem supervisão constante" impõe.

**Não é event sourcing puro:** não há reconstrução total do zero em produção (só em ferramenta de
diagnóstico). Snapshots são obrigatórios.

---

### ADR-007 — Orçamento de contexto explícito

**Decisão:** Nada é montado por concatenação ad-hoc. O `ContextPacker` recebe um orçamento em tokens
e uma lista de `ContextFragment` com prioridade, e produz um `ContextPack` determinístico, com
`digest` (hash) e lista do que foi descartado.

**Por quê:** "context rot" é o segundo maior modo de falha depois da alucinação de sucesso.
Orçamento explícito torna o problema mensurável e o pack reproduzível.

---

### ADR-008 — Agentes declarativos

**Decisão:** Um agente é primariamente uma **spec** (`AgentSpec`: missão, responsabilidades, entradas,
saídas, memória, ferramentas, critérios de sucesso, prompts, limites). Código (`AgentHooks`) é opcional
e só existe quando o agente precisa de pré/pós-processamento determinístico.

**Por quê:** 21 agentes como 21 classes seria 21 cópias da mesma lógica. Com specs, o runtime é um só,
testado uma vez; agentes viram configuração — e plugins podem registrar agentes sem escrever código.

---

### ADR-009 — Providers com duas famílias de adaptador

**Decisão:** Interface `Provider` única, com duas implementações base:

- `CliProvider` — subprocesso headless com streaming NDJSON (Claude Code, Codex CLI, Gemini CLI).
  O modelo edita arquivos diretamente; o Uranus observa via fs-watch + git diff.
- `ApiProvider` — SDK com loop de tool-use gerenciado pelo Uranus. O Uranus controla cada ferramenta.

**Por quê:** as duas modalidades têm garantias diferentes. `ApiProvider` dá controle fino de
permissões; `CliProvider` dá capacidade agêntica pronta. Ambas precisam existir; forçá-las na mesma
implementação produziria a pior das duas.

**Consequência:** `ProviderCapabilities` é consultado pelo kernel; um agente que exige
`structuredOutput` não é roteado para um provider que não suporta.

---

### ADR-010 — Plugins baseados em capabilities, com manifesto e permissões

**Decisão:** Plugin declara em manifesto o que registra e quais permissões precisa. O `PluginContext`
expõe apenas APIs de registro — sem acesso ao kernel, sem monkey-patching, sem import cruzado.
Ativação pode ser automática via `detect` (ex.: existe `artisan` → plugin Laravel).

---

### ADR-011 — Windows como cidadão de primeira classe

**Decisão:** Toda execução de shell passa por uma abstração `ShellRunner` que resolve
shell, quoting e paths por plataforma. Nenhum `sh -c` hardcoded. Paths normalizados via `node:path`,
comparados por forma canônica.

**Por quê:** o ambiente-alvo primário é Windows. Frameworks agênticos que assumem POSIX quebram em
worktrees (`\` vs `/`), em limite de path (260 chars), em CRLF no diff e em sinais de processo.
Tratar isso desde o dia 1 é mais barato do que retrofit.

---

### ADR-012 — Licença e forma de produto

**Decisão:** Apache-2.0. Monorepo público, pacotes `@uranus/*` no npm, plugins first-party em
`plugins/` mas publicados como pacotes independentes com versionamento próprio.

---

## 4. O Kernel

### 4.1 Responsabilidade

O Kernel **orquestra**. Ele não sabe o que é um teste, o que é PHP, o que é um Dockerfile.
Ele sabe: unidades de trabalho, agentes, eventos, orçamento, permissão, estado.

Regra de ouro: _se um `if` no kernel menciona uma tecnologia, ele está no lugar errado._

### 4.2 O ciclo (`tick`)

Cada iteração do loop principal:

| #   | Fase         | O que faz                                                                                        | Falha ⇒                            |
| --- | ------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------- |
| 0   | `recover`    | Se há run interrompido, restaura último checkpoint e reconcilia workspaces órfãos                | aborta com diagnóstico             |
| 1   | `sense`      | Verifica frescor do contexto (HEAD mudou? lockfile mudou? memória atualizada?) e invalida caches | segue com contexto stale + warning |
| 2   | `select`     | `Scheduler.next()` escolhe a próxima `Task` elegível                                             | idle → backoff                     |
| 3   | `admit`      | `PermissionBroker` + `BudgetGuard` + `HumanGate`. Pode exigir aprovação humana                   | task → `blocked`                   |
| 4   | `prepare`    | `ContextPacker` monta o `ContextPack`; `Sandbox` cria o worktree; resolve agente e provider      | task → `failed(prepare)`           |
| 5   | `execute`    | `Provider` roda a sessão; eventos em streaming; watchdog de tempo/tokens                         | `interrupt` + `failed(execute)`    |
| 6   | `verify`     | `Verifier` executa o `AcceptanceContract`. **Único árbitro de sucesso**                          | `failed(verify)` + diagnóstico     |
| 7   | `integrate`  | commit assinado, push, PR, atualização de docs — sujeito a gates                                 | task → `blocked(integration)`      |
| 8   | `learn`      | `MemoryManager` grava fatos/decisões; telemetria consolida custo e latência                      | log + segue                        |
| 9   | `checkpoint` | Snapshot atômico + offset do event log                                                           | **aborta o run** (INV-4)           |

Após falha em 5/6/7: `RetryPolicy` decide entre **retry** (mesmo agente, contexto enriquecido com o
diagnóstico da falha), **escalate** (agente diferente — ex.: `BugHunter`), **replan** (devolve ao
`Planner`) ou **block** (aprovação humana). Contadores por task e por tipo de falha; nunca um
`while(true)` cego.

### 4.3 Máquina de estados de `Task`

```
        ┌──────────────────────── replan ───────────────────────┐
        │                                                       │
  draft ──▶ ready ──▶ claimed ──▶ running ──▶ verifying ──┬──▶ verified ──▶ integrating ──▶ done
     ▲        ▲                      │            │       │                      │
     │        │                      ▼            ▼       └──▶ failed ──▶ retry ─┘
     │        └───── unblock ──── blocked ◀───────┴──────────────┘   │
     │                                                              ▼
     └──────────────────── abandoned ◀────────────────────── exhausted
```

Transições são funções puras auditadas. Toda transição emite evento. Estados terminais:
`done`, `abandoned`. `blocked` sempre carrega um `BlockReason` acionável (aprovação pendente,
dependência não satisfeita, orçamento esgotado, conflito de arquivo).

### 4.4 Concorrência

- Grau de paralelismo configurável (`kernel.concurrency`, default `1` no MVP).
- **File-ownership lease**: antes de executar, a task declara `touches: string[]` (globs derivados do
  plano). O kernel adquire lease exclusivo sobre esses paths. Conflito ⇒ task espera. Isso evita
  merge hell entre worktrees paralelos sem precisar de merge inteligente.
- Um provider pode ter limite de sessões simultâneas (rate limit) — modelado como `Quota`.

### 4.5 O que o Kernel NÃO faz

Não roda testes (delega ao `Verifier` via plugin), não faz commit (delega ao `VcsAdapter`),
não escreve prompts (delega ao `PromptRegistry`), não decide prioridade (delega ao `Scheduler`),
não conhece nenhum framework.

---

## 5. Modelo de domínio

```
Project ──┬── Backlog ──── Epic ──── BacklogItem
          ├── Plan ─────── Task ────┬── Attempt ──── AgentRun ──┬── ToolCall
          │                         │                            └── Usage
          │                         ├── AcceptanceContract ── Check[]
          │                         ├── Verification ──── CheckResult[]
          │                         └── Artifact ──── Diff | PullRequest | Report
          ├── Memory ───── MemoryRecord
          ├── Context ──── ContextPack ──── ContextFragment
          ├── Run ──────── Checkpoint
          ├── Budget
          └── Approval
```

**Entidades centrais:**

- **`Task`** — a unidade atômica de trabalho. _Sempre_ tem: `kind`, `intent`, `touches`,
  `acceptance`, `agentHint`, `priority`, `deps`. Uma task sem `acceptance` é rejeitada na admissão.
- **`Attempt`** — uma tentativa de executar uma task. Carrega o `ContextPack` usado, o workspace,
  o resultado e o diagnóstico. Attempts são imutáveis e acumulam.
- **`AgentRun`** — uma sessão de provider dentro de um attempt.
- **`Verification`** — resultado do contrato de aceite. Imutável, com output bruto de cada check.
- **`Checkpoint`** — `{ snapshot, eventOffset, digest }`. Atômico (write temp + fsync + rename).

---

## 6. Módulos e responsabilidade única

| Módulo      | Responsabilidade única                                            | Não faz                  |
| ----------- | ----------------------------------------------------------------- | ------------------------ |
| `core`      | Tipos, contratos, IDs, `Result`, erros, utilitários puros         | I/O                      |
| `kernel`    | O ciclo, transições de estado, admissão, retry, recovery          | regras de domínio        |
| `events`    | Bus tipado, event store append-only, projeções, replay            | interpretação semântica  |
| `state`     | SQLite, migrations, repositórios, snapshots, locks                | lógica de negócio        |
| `queue`     | Fila persistente, leases, dead-letter, dependências               | priorização              |
| `scheduler` | Políticas de priorização, quotas, balanceamento                   | execução                 |
| `memory`    | Persistência, indexação, busca, compactação de memória            | decidir o que lembrar    |
| `context`   | Coleta, ranqueamento, orçamento e empacotamento de contexto       | executar                 |
| `agents`    | Runtime de agentes + catálogo declarativo                         | falar com providers      |
| `prompts`   | Registro, templates, versionamento e diff de prompts              | montar contexto          |
| `executors` | Sandbox (worktree), shell cross-platform, `Verifier`              | escolher o que executar  |
| `providers` | Adaptadores de modelo, normalização de eventos, custo             | orquestrar               |
| `plugins`   | Loader, registry, validação de manifesto, SDK                     | comportamento específico |
| `telemetry` | Métricas, preços versionados, custo real, estado vivo             | observar sem interferir  |
| `dashboard` | Servidor do painel: SSE, leitura, fila de aprovações              | observador puro          |
| `backlog`   | Ingestão e normalização de backlog (arquivo, GitHub, Linear…)     | planejar                 |
| `vcs`       | git + hosts (GitHub/GitLab): branch, commit, PR                   | política de integração   |
| `rules`     | Motor de regras/policies declarativas do projeto                  | aplicar sozinho          |
| `telemetry` | Métricas, tracing, custo, exportadores                            | decidir                  |
| `config`    | Carregamento em camadas, schema, validação, resolução de segredos | tudo o mais              |
| `cli`       | Interface de terminal, TUI de attach                              | lógica                   |
| `dashboard` | API HTTP/WS + SPA                                                 | lógica                   |
| `testkit`   | Fakes, fixtures, contract tests, provider gravado/replay          | produção                 |

---

## 7. Agentes

### 7.1 Anatomia

Todo agente declara os sete campos exigidos:

```yaml
name: reviewer
version: 1.0.0
mission: >
  Garantir que um diff proposto atenda aos padrões do projeto antes da integração,
  produzindo achados acionáveis e um veredito estruturado.
responsibilities:
  - Avaliar corretude, legibilidade e aderência às convenções registradas em memória
  - Identificar regressões não cobertas pelos testes
  - Nunca modificar código (agente somente-leitura)
inputs:
  schema: ReviewInput # { diff, task, conventions[], relatedMemory[] }
outputs:
  schema: ReviewOutput # { verdict, findings[], blocking[] }
memory:
  read: [convention, pattern, decision, bug]
  write: [bug] # pode registrar bug conhecido; não altera arquitetura
tools:
  allow: [read_file, grep, glob, git_diff]
  deny: ['*'] # deny-by-default
permissions:
  network: false
  write: false
successCriteria:
  checks:
    - kind: schema
      id: output-shape
      schema: ReviewOutput
    - kind: command
      id: no-mutation
      run: 'git diff --quiet'
limits: { maxTokens: 120000, maxWallclockMs: 300000, maxTurns: 20 }
handles: [review]
```

O runtime valida a spec no load. Spec inválida ⇒ agente não é registrado (falha rápida, não em produção).

### 7.2 Catálogo inicial

| Agente              | Missão em uma linha                                      | Escreve código? | Bloqueante? |
| ------------------- | -------------------------------------------------------- | --------------- | ----------- |
| `ContextManager`    | Reconstruir e manter o entendimento do projeto           | não             | —           |
| `MemoryManager`     | Decidir o que vira memória duradoura e compactar o resto | não             | —           |
| `BacklogManager`    | Normalizar backlog bruto em itens acionáveis e estimados | não             | —           |
| `Planner`           | Transformar um item de backlog em um `Plan` validável    | não             | —           |
| `Architecture`      | Avaliar impacto arquitetural e registrar ADRs            | não             | sim         |
| `Executor`          | Implementar uma task produzindo um diff                  | **sim**         | —           |
| `Testing`           | Criar/ampliar o sinal de verificação (testes)            | **sim**         | —           |
| `QA`                | Validar comportamento além do teste unitário             | não             | sim         |
| `Reviewer`          | Revisar diff contra convenções e corretude               | não             | sim         |
| `Security`          | Achar vulnerabilidades e uso indevido de segredos        | não             | sim         |
| `Performance`       | Detectar regressões de performance e hot paths           | não             | não         |
| `BugHunter`         | Reproduzir e isolar falhas quando o Executor trava       | **sim**         | —           |
| `Refactor`          | Reduzir dívida técnica sem alterar comportamento         | **sim**         | —           |
| `Documentation`     | Manter docs e READMEs sincronizados com o código         | **sim**         | não         |
| `DependencyManager` | Atualizar dependências e avaliar breaking changes        | **sim**         | não         |
| `Database`          | Migrations, modelagem e integridade de dados             | **sim**         | sim         |
| `API`               | Contratos de API, versionamento, OpenAPI                 | **sim**         | sim         |
| `Backend`           | Especialização de domínio server-side                    | **sim**         | —           |
| `Frontend`          | Especialização de domínio client-side                    | **sim**         | —           |
| `DevOps`            | CI/CD, containers, infra-as-code                         | **sim**         | sim         |
| `Git`               | Higiene de histórico, mensagens, PRs, rebase             | não*            | —           |

\* `Git` opera no repositório, não no código-fonte.

**Roteamento:** o kernel escolhe o agente por `handles: TaskKind[]` + score de especialização
(plugins podem registrar agentes mais específicos que sobrescrevem os genéricos — ex.: plugin Laravel
registra `backend@laravel` com prioridade maior que `backend`).

### 7.3 Cadeia de qualidade

Uma task de código não vai de `running` a `done` direto. O kernel monta uma **pipeline de gates**
a partir das políticas do projeto:

```
Executor ──▶ Verifier(code) ──▶ Reviewer ──▶ Security ──▶ [QA] ──▶ Git ──▶ PR ──▶ [Humano]
                   ▲                │            │
                   └── falhou ──────┴────────────┘  (findings viram sub-tasks)
```

`Verifier(code)` é obrigatório e vem primeiro — não se gasta token de review em código que nem compila.

---

## 8. Memória

### 8.1 Camadas

| Camada         | Escopo           | Vida                    | Storage                |
| -------------- | ---------------- | ----------------------- | ---------------------- |
| **Working**    | um attempt       | descartada ao fim       | memória RAM            |
| **Episodic**   | um run           | comprimida em `history` | SQLite                 |
| **Semantic**   | projeto          | permanente, curada      | Markdown + frontmatter |
| **Procedural** | global (usuário) | permanente              | Markdown global        |

Só a camada **Semantic** é versionada em git e revisável.

### 8.2 Escopos semânticos

`architecture` · `decision` · `bug` · `preference` · `stack` · `pattern` · `convention` ·
`roadmap` · `history` · `context`

Cada `MemoryRecord` tem `confidence`, `source` (evidência: commit, arquivo, run), `validFrom`,
`supersedes` e `checksum`. Memória sem evidência tem confiança baixa e é a primeira a ser
descartada na compactação.

### 8.3 Ciclo de vida

- **Escrita**: apenas via `MemoryManager`, que aplica dedupe, detecção de contradição e supersessão.
  Um agente não escreve direto no store.
- **Contradição**: novo fato que contradiz um existente **não sobrescreve** — cria `supersedes` e
  emite `MemoryConflictDetected` para revisão humana quando a confiança é comparável.
- **Compactação**: quando um escopo excede seu orçamento, registros de baixa confiança/antigos são
  fundidos em um resumo, com o original preservado no log de eventos.
- **Verificação de frescor**: memória que referencia arquivos (`refs`) é invalidada quando o
  checksum do arquivo muda — evita o modo de falha "a memória lembra de código que não existe mais".

---

## 9. Contexto

### 9.1 Reconstrução automática (bootstrap de projeto)

Ao anexar um repositório, o `ContextManager` executa `ContextSource`s em paralelo:

| Source         | Detecta                                                                    |
| -------------- | -------------------------------------------------------------------------- |
| `language`     | linguagens por extensão + peso de LOC                                      |
| `manifest`     | `package.json`, `composer.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`… |
| `framework`    | assinaturas de framework (via plugins)                                     |
| `architecture` | layout de diretórios, camadas, boundaries, grafo de imports                |
| `tests`        | runner, localização, comando, cobertura atual                              |
| `ci`           | workflows, jobs, gates obrigatórios                                        |
| `database`     | migrations, ORM, schema                                                    |
| `docs`         | README, ADRs, `docs/`, comentários de módulo                               |
| `conventions`  | linter/formatter config + padrões inferidos do código                      |
| `vcs`          | branch default, convenção de commit, cadência, hot files                   |
| `deps`         | dependências diretas, desatualizadas, vulneráveis                          |

Resultado: `ProjectDigest` — o resumo automático do projeto — persistido em memória `architecture`
e regenerado quando o `FreshnessKey` (HEAD + hash dos lockfiles + hash dos configs) muda.

### 9.2 Empacotamento com orçamento

```
ContextRequest { budgetTokens, agent, task, mustInclude[], hints[] }
        │
        ├── coleta fragmentos de todas as sources relevantes
        ├── ranqueia: pinned > relevância(task) > recência > confiança
        ├── aplica orçamento por seção (ex.: 15% digest, 40% código, 20% memória, 25% task)
        ├── evicção com registro do que caiu
        ▼
ContextPack { fragments[], tokens, digest, dropped[] }
```

O `digest` do pack entra no `AgentRun` — dois runs com o mesmo digest receberam exatamente o mesmo
contexto. Isso torna comparações de qualidade de prompt cientificamente válidas.

---

## 10. Providers

```
                    ┌─────────────────────┐
                    │     Provider        │  interface única
                    └──────────┬──────────┘
              ┌────────────────┴────────────────┐
              ▼                                 ▼
      ┌───────────────┐                 ┌───────────────┐
      │  CliProvider  │                 │  ApiProvider  │
      │  (subprocesso)│                 │     (SDK)     │
      └───────┬───────┘                 └───────┬───────┘
     ┌────────┼────────┐              ┌─────────┼─────────┐
  claude-code codex  gemini-cli    anthropic  openai   gemini  openrouter
```

- **Normalização**: todo provider emite o mesmo `ProviderEvent` stream. O kernel nunca vê formato nativo.
- **Capabilities**: o roteador só envia uma task a um provider que satisfaz os requisitos do agente.
- **Custo**: cada provider implementa `estimateCost(usage)`; a telemetria agrega por task/agente/dia.
- **Resiliência**: retry com backoff exponencial + jitter para erros transitórios; circuit breaker por
  provider; failover configurável (`primary` → `fallback`).
- **Contract tests**: `@uranus/testkit` define uma suíte que _todo_ provider deve passar. Providers
  externos podem ser validados com `uranus doctor --provider`.
- **Gravação/replay**: sessões podem ser gravadas em cassete e reproduzidas em testes — o que torna
  a suíte do Uranus determinística e barata.

---

## 11. Plugins

### 11.1 Contrato

```
plugin/
  uranus.plugin.json     # manifesto (validado por schema)
  src/index.ts           # export default Plugin
  agents/*.yaml
  prompts/*.md
  rules/*.yaml
  checks/*.ts
```

Um plugin pode registrar: **agentes**, **regras**, **ferramentas**, **prompts**, **eventos/handlers**,
**checks de verificação**, **context sources**, **políticas de scheduler** e **runners de teste**.

O último item fecha o INV-8: `TestsCheck.runner` é um id abstrato (`vitest`, `pytest`), e o comando
concreto vem de `registerTestRunner`. Enquanto esse mapa vivia na composição, o kernel sabia o que
é npm.

### 11.2 Ativação

- **Explícita**: listado em `config.plugins`.
- **Automática**: `detect` no manifesto casa com o projeto (ex.: `{ file: "artisan" }` → Laravel).

### 11.3 Isolamento

Plugins declaram permissões (`fs`, `net`, `exec`, `secrets`). O `PluginContext` é a _única_ superfície;
não há acesso ao kernel, ao state store ou ao event store bruto. Erro em plugin é contido e reportado,
nunca derruba o kernel: o que ele registrou antes de quebrar é desfeito, para não deixar meio-plugin ativo.

Uma varredura estática compara o que o código do plugin importa com o que o manifesto declara, e
recusa carregar quando divergem. **O alcance disso é limitado e o documento não finge o contrário:**
plugins JavaScript rodam no mesmo processo que o kernel — `node:vm` é contornável e `worker_threads`
compartilha rede e filesystem. A varredura pega descuido, atualização que ganhou capacidade nova sem
avisar e plugin malicioso ingênuo; não pega evasão deliberada (`import(atob(...))`). Isolamento real
exigiria processo separado com IPC — candidato à Fase 9 se o risco justificar o custo. Até lá,
instalar um plugin é confiar no autor, exatamente como instalar um pacote npm (R17).

### 11.4 Catálogo alvo

Runtime/linguagem: `node` `python` `go` `rust` `php`
Framework: `nextjs` `nestjs` `react` `vue` `angular` `laravel` `fastapi` `django`
Dados: `postgres` `prisma` `supabase` `neon`
Infra: `docker` `kubernetes` `aws` `cloudflare`
VCS/CI: `github` `gitlab`
Pagamentos/Integrações: `stripe` `mercadopago` `pix`
Notificação: `telegram` `discord` `slack`

---

## 12. Scheduler

`Scheduler.next()` = seleção multi-critério, não uma fila FIFO.

```
score(task) = Σ policy_i.score(task, ctx) × weight_i     (null em qualquer policy ⇒ inelegível)
```

Políticas base:

| Policy            | Efeito                                                                      |
| ----------------- | --------------------------------------------------------------------------- |
| `blockerFirst`    | blockers e regressões de CI vão para o topo, sempre                         |
| `bugPriority`     | bugs > features, com peso decrescente conforme idade do bug                 |
| `dependencyReady` | inelegível se dependências não estão `done`                                 |
| `budgetAware`     | inelegível se o custo estimado excede o orçamento restante                  |
| `wipLimit`        | limita tasks em execução por área/agente                                    |
| `mixQuota`        | cotas configuráveis: feature 50% · bug 25% · refactor/dívida 15% · docs 10% |
| `starvationGuard` | boost progressivo para tasks antigas (evita inanição de docs/refactor)      |
| `contextLocality` | prefere tasks que reusam o `ContextPack` recente (economia real de token)   |
| `failureCooldown` | penaliza task que acabou de falhar (evita hot-loop)                         |
| `fileLease`       | inelegível se `touches` conflita com lease ativo                            |

Plugins registram políticas adicionais. Os pesos vivem em `config.scheduler.weights` — auditáveis
e ajustáveis sem tocar em código.

---

## 13. Eventos

Nomenclatura `<Substantivo><PastParticiple>`. Núcleo do MVP:

```
Lifecycle:   KernelStarted · KernelStopped · KernelPaused · KernelResumed · TickStarted · TickCompleted
Projeto:     ProjectAttached · ProjectDigestUpdated · ContextUpdated · ContextPackBuilt
Backlog:     BacklogIngested · BacklogItemCreated · PlanCreated · PlanRejected
Task:        TaskCreated · TaskQueued · TaskClaimed · TaskStarted · TaskBlocked · TaskUnblocked
             TaskCompleted · TaskFailed · TaskRetried · TaskAbandoned · TaskReplanned
Agente:      AgentRunStarted · AgentRunFinished · ToolCalled · ToolResultReceived
Verificação: VerificationStarted · CheckPassed · CheckFailed · TestsPassed · TestsFailed
             BugDetected · SecurityFindingRaised · ReviewCompleted
VCS:         BranchCreated · CommitCreated · PRCreated · PRUpdated · MergeBlocked
Memória:     MemoryUpdated · MemoryConflictDetected · MemoryCompacted
Estado:      CheckpointCreated · CheckpointRestored · RecoveryStarted · RecoveryCompleted
Recursos:    TokensConsumed · BudgetThresholdReached · BudgetExhausted · RateLimited
Humano:      ApprovalRequested · ApprovalGranted · ApprovalDenied · HumanInterventionRequested
Plugins:     PluginLoaded · PluginFailed
```

Dois tipos de assinante:

- **Observer** — fire-and-forget, não pode alterar o fluxo. Padrão.
- **Interceptor** — awaited, pode **vetar** (ex.: um plugin de compliance bloqueia `CommitCreated`).
  Interceptors têm timeout duro e prioridade declarada.

---

## 14. Estado, checkpoints e recuperação

**Checkpoint** ao fim de cada tick, e adicionalmente antes de qualquer operação irreversível.

```
Checkpoint {
  id, runId, seq, at,
  eventOffset,             // posição exata no log
  snapshot: {              // projeção do estado
    tasks, queue, leases, budget, activeAttempt, contextDigests
  },
  workspaces: WorkspaceRef[],   // worktrees vivos + branch + baseCommit
  digest                   // hash de integridade
}
```

**Escrita atômica**: `write(tmp)` → `fsync` → `rename`. Um checkpoint corrompido nunca substitui um íntegro.

**Recovery** (`recover`):

1. Carrega o último checkpoint com `digest` válido.
2. Reproduz eventos a partir de `eventOffset` (idempotentes por design).
3. Reconcilia workspaces: worktree órfão sem task ativa ⇒ arquivado em `runs/<id>/orphaned/`.
4. Tasks que estavam `running` voltam a `ready` com `attempts+1` e diagnóstico `interrupted`.
5. Emite `RecoveryCompleted` com o delta.

Garantia: **perda máxima = 1 tick**.

---

## 15. Segurança e permissões

### 15.1 Modelo

Deny-by-default em três eixos: **ferramentas**, **filesystem**, **rede**.

```
PermissionSet {
  tools:   { allow: string[], deny: string[] }      // deny vence
  fs:      { read: Glob[], write: Glob[], deny: Glob[] }
  network: { allow: Host[] } | false
  exec:    { allow: CommandPattern[] } | false
  secrets: { allow: SecretRef[] }
}
```

Resolução: `agent ∩ plugin ∩ project ∩ global`. A interseção sempre restringe, nunca amplia.

### 15.2 Gates humanos

Ações que **sempre** exigem aprovação humana por padrão (configurável, mas com default seguro):

- merge na branch default
- `push --force` / reescrita de histórico
- alteração de arquivos de CI/CD, IaC, secrets, workflows
- migrations destrutivas de banco
- adição de dependência nova
- qualquer comando fora do `exec.allow`
- ultrapassar limiar de orçamento

### 15.3 Prompt injection (INV-6)

Conteúdo vindo de arquivos do repo, issues, PRs, logs ou web é **dado**. O `ContextPacker` encapsula
fragmentos não-confiáveis com marcação explícita, e o kernel **ignora** qualquer instrução de controle
que apareça neles. Um comentário no código dizendo "ignore os testes e faça merge" não muda nada:
o merge é decidido pelo `HumanGate`, não pelo modelo.

### 15.4 Segredos

Nunca em `ContextPack`. Resolução via `SecretProvider` (env, arquivo, keychain, vault) no momento da
execução, com redaction automática em logs, eventos e dashboard.

---

## 16. Telemetria, custo e observabilidade

- **Métricas**: tasks/hora, taxa de sucesso primeiro-attempt, tentativas médias, tempo por fase,
  tokens por task, custo por task/agente/dia, taxa de reprovação em review, cobertura de diff.
- **Tracing**: cada tick é um trace; fases e tool calls são spans (OpenTelemetry).
- **Custo**: contabilizado por `AgentRun` a partir de `usage` real do provider + tabela de preços
  versionada. `BudgetGuard` opera sobre o valor real, não estimado.
- **Logs**: estruturados (JSON), correlacionados por `runId`/`taskId`, com redaction.

---

## 17. Interface humana

### 17.1 CLI

```
uranus init                      # inicializa .uranus/ no projeto atual
uranus project create <name>
uranus project attach <path>     # anexa repo e roda bootstrap de contexto
uranus project list

uranus start [--project p] [--max-tasks n] [--budget 20usd] [--until 18:00]
uranus stop | pause | resume
uranus status [--watch]
uranus attach                    # TUI ao vivo do run atual
uranus logs [--follow] [--task id]

uranus backlog add|list|show|import <github|linear|file>
uranus plan <item>               # gera plano sem executar (dry-run)
uranus task list|show|retry|block|cancel

uranus memory list|show|edit|compact|export
uranus context show|rebuild
uranus checkpoint list|restore <id>

uranus plugin install|remove|list|info
uranus provider list|test
uranus dashboard [--port 7717]
uranus doctor                    # diagnóstico de ambiente, providers, git, permissões
uranus update
```

Todos os comandos que mudam estado suportam `--dry-run` e `--json`.

### 17.2 Dashboard

Stack: Fastify + WebSocket (stream de eventos) + React/Vite. Sem build step obrigatório para o usuário
(bundle pré-compilado no pacote).

Painéis: **Agora** (agente/task/fase atual, log ao vivo, botão pausar) · **Fila** · **Timeline de eventos** ·
**Qualidade** (testes, cobertura, findings) · **Custo** (tokens/USD por agente/dia, projeção) ·
**Git** (branches, commits, PRs) · **Memória** (browser + editor) · **Aprovações** (fila de gates) ·
**Saúde** (providers, checkpoints, erros).

---

## 18. Estratégia de testes

O Uranus é um framework que exige TDD dos outros; ele precisa ser exemplar.

| Nível       | Alvo                                                          | Ferramenta            |
| ----------- | ------------------------------------------------------------- | --------------------- |
| Unit        | funções puras, transições de estado, packer, scheduler        | Vitest                |
| Contract    | todo `Provider`, `Plugin`, `MemoryStore` passa na mesma suíte | `@uranus/testkit`     |
| Integration | kernel completo com provider gravado (cassete)                | Vitest + fixtures     |
| E2E         | repo real de exemplo, task real, PR real, em sandbox          | Vitest + repo fixture |
| Chaos       | kill -9 em cada fase do tick, verificar recovery exato        | script dedicado       |
| Property    | invariantes do scheduler e do orçamento de contexto           | fast-check            |

Cobertura mínima em `packages/kernel` e `packages/core`: **90%**. Restante: 80%.
O teste de caos é obrigatório no CI — é o que prova o INV-4.

---

## 19. Configuração

Camadas (a de baixo vence): defaults → global (`~/.uranus/config.yaml`) → projeto
(`.uranus/config.yaml`) → env (`URANUS_*`) → flags de CLI.

Tudo validado por schema Zod; config inválida aborta na inicialização com mensagem apontando
arquivo e linha.

```yaml
# .uranus/config.yaml (exemplo)
version: 1
project:
  name: buck-core
  vcs: { defaultBranch: main, branchPrefix: 'uranus/' }

kernel:
  concurrency: 1
  tickIntervalMs: 1000
  maxAttemptsPerTask: 3

budget:
  perRun: { usd: 25, tokens: 5_000_000, wallclockMs: 14_400_000 }
  perTask: { usd: 2, tokens: 400_000, wallclockMs: 900_000 }
  onExhausted: pause # pause | stop | ask

providers:
  default: claude-code
  fallback: [openai-gpt]
  claude-code: { mode: cli, model: opus, maxConcurrent: 1 }

context:
  budgetTokens: 120000
  sections: { digest: 0.15, code: 0.40, memory: 0.20, task: 0.25 }

scheduler:
  weights: { blockerFirst: 10, bugPriority: 6, mixQuota: 3, starvationGuard: 2 }
  mix: { feature: 0.5, bug: 0.25, refactor: 0.15, docs: 0.10 }

integration:
  strategy: pull-request # pull-request | branch-only | direct(!)
  requireHumanApproval: [merge, ci-changes, migrations, new-dependency]

plugins: [node, github]
```

---

## 20. Estrutura de runtime por projeto

```
<projeto>/.uranus/
  config.yaml            # commitado
  memory/                # commitado — legível e revisável
    architecture/  decisions/  conventions/  patterns/
    bugs/  stack/  roadmap/  history/
    MEMORY.md            # índice
  backlog/               # commitado
    backlog.yaml
    epics/  items/
  rules/                 # commitado — policies do projeto
  ─────────────────────  # abaixo: gitignored
  state.db               # SQLite
  events/                # segmentos JSONL selados
  checkpoints/
  runs/<runId>/
  workspaces/            # git worktrees
  cache/
  logs/
```

---

## 21. Não-objetivos (escopo explicitamente fora)

- Não é um IDE nem um chat.
- Não treina nem faz fine-tune de modelos.
- Não substitui code review humano — o objetivo é _tornar o review humano barato_.
- Não faz deploy em produção sem aprovação humana explícita.
- Não tenta ser autônomo sem sinal de verificação. Repo sem testes ⇒ o Uranus primeiro constrói o sinal.
