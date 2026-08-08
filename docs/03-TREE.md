# Uranus — Árvore completa do projeto

Monorepo pnpm. Pacotes publicados como `@uranus/*`. Plugins first-party versionados
independentemente sob `plugins/`.

`[F1]…[F9]` marcam a fase do roadmap em que o item passa a existir.

```
uranus/
├── package.json                        # workspace root, scripts, engines
├── pnpm-workspace.yaml
├── tsconfig.base.json                  # strict, ESM, moduleResolution: bundler
├── vitest.workspace.ts
├── eslint.config.js
├── .prettierrc
├── .editorconfig                        # LF forçado — ADR-011
├── .gitattributes                       # * text=auto eol=lf
├── .npmrc
├── LICENSE                              # Apache-2.0
├── README.md
├── CHANGELOG.md
├── CONTRIBUTING.md
├── SECURITY.md
│
├── .github/
│   └── workflows/
│       ├── ci.yml                       # lint · typecheck · test (windows + ubuntu)
│       ├── chaos.yml                    # teste de recuperação — obrigatório  [F2]
│       └── release.yml                  # changesets → npm                    [F9]
│
├── docs/
│   ├── 00-ARCHITECTURE.md
│   ├── 01-CONTRACTS.md
│   ├── 02-ROADMAP.md
│   ├── 03-TREE.md
│   ├── 04-RISKS.md
│   ├── adr/                             # 0001-language.md, 0002-kernel.md, ...
│   ├── guides/                          # writing-plugins, writing-agents, providers
│   └── reference/                       # events, config, cli
│
├── packages/
│   │
│   ├── core/                            # @uranus/core — tipos e contratos. ZERO I/O.   [F1]
│   │   └── src/
│   │       ├── index.ts
│   │       ├── ids.ts                   # branded ids + geração (ULID)
│   │       ├── result.ts
│   │       ├── errors.ts                # hierarquia UranusError
│   │       ├── clock.ts  logger.ts
│   │       ├── domain/
│   │       │   ├── task.ts  plan.ts  attempt.ts  project.ts
│   │       │   ├── acceptance.ts        # Check, AcceptanceContract
│   │       │   ├── verification.ts      # Verification, CheckResult, Diagnosis
│   │       │   ├── memory.ts  context.ts  budget.ts  permission.ts
│   │       │   └── state-machine.ts     # transições puras de Task
│   │       ├── contracts/               # as interfaces de 01-CONTRACTS.md
│   │       │   ├── provider.ts  agent.ts  plugin.ts  tool.ts
│   │       │   ├── memory-store.ts  context-source.ts  scheduler.ts
│   │       │   ├── queue.ts  sandbox.ts  vcs.ts  verifier.ts
│   │       │   ├── event-bus.ts  checkpoint.ts  telemetry.ts
│   │       │   └── kernel.ts
│   │       └── util/                    # tokens.ts (estimativa), glob.ts, path.ts, redact.ts
│   │
│   ├── config/                          # @uranus/config                                [F1]
│   │   └── src/{index,schema,loader,layers,secrets,defaults}.ts
│   │
│   ├── events/                          # @uranus/events                                [F1]
│   │   └── src/
│   │       ├── bus.ts                   # observers + interceptors com veto
│   │       ├── store/{jsonl-store,sqlite-index,segments}.ts
│   │       ├── catalog.ts               # EventName + EventPayloads (fonte da verdade)
│   │       ├── projections/{task,run,metrics}.ts
│   │       └── replay.ts
│   │
│   ├── state/                           # @uranus/state                                 [F1]
│   │   └── src/
│   │       ├── db.ts                    # SQLite WAL, pragmas, pool
│   │       ├── migrations/              # 0001_init.sql, ...
│   │       ├── repositories/{task,attempt,run,lease,memory-index,metric}.ts
│   │       ├── locks.ts                 # leases com TTL
│   │       └── snapshot.ts              # escrita atômica tmp→fsync→rename
│   │
│   ├── queue/                           # @uranus/queue                                 [F2]
│   │   └── src/{queue,lease,dependencies,dead-letter,stats}.ts
│   │
│   ├── kernel/                          # @uranus/kernel                                [F2]
│   │   └── src/
│   │       ├── kernel.ts                # composition root + loop
│   │       ├── tick/
│   │       │   ├── recover.ts  sense.ts  select.ts  admit.ts  prepare.ts
│   │       │   ├── execute.ts  verify.ts  integrate.ts  learn.ts  checkpoint.ts
│   │       │   └── pipeline.ts          # composição das fases
│   │       ├── policies/{retry,escalation,integration}.ts
│   │       ├── guards/{budget,permission,human-gate,quota}.ts
│   │       ├── recovery/{manager,reconcile-workspaces}.ts
│   │       ├── checkpoint/{manager,store}.ts
│   │       └── router/{agent-router,provider-router}.ts
│   │
│   ├── scheduler/                       # @uranus/scheduler                             [F4]
│   │   └── src/
│   │       ├── scheduler.ts  explain.ts
│   │       └── policies/
│   │           ├── blocker-first.ts  bug-priority.ts  dependency-ready.ts
│   │           ├── budget-aware.ts  wip-limit.ts  mix-quota.ts
│   │           ├── starvation-guard.ts  context-locality.ts
│   │           ├── failure-cooldown.ts  file-lease.ts
│   │
│   ├── context/                         # @uranus/context                               [F3]
│   │   └── src/
│   │       ├── packer.ts                # orçamento por seção + digest determinístico
│   │       ├── ranker.ts  budget.ts  cache.ts  freshness.ts
│   │       ├── digest/{builder,summary}.ts       # ProjectDigest
│   │       ├── untrusted.ts             # encapsulamento anti-injection (INV-6)
│   │       └── sources/
│   │           ├── language.ts  manifest.ts  framework.ts  architecture.ts
│   │           ├── tests.ts  ci.ts  database.ts  docs.ts
│   │           ├── conventions.ts  vcs.ts  deps.ts
│   │           ├── task-source.ts  memory-source.ts  failure-source.ts
│   │
│   ├── memory/                          # @uranus/memory                                [F3]
│   │   └── src/
│   │       ├── store/{markdown-store,frontmatter,layout}.ts
│   │       ├── index/{fts,vector,embedder}.ts
│   │       ├── manager.ts               # dedupe, contradição, supersessão
│   │       ├── revalidate.ts            # invalidação por checksum de CodeRef
│   │       ├── compaction.ts
│   │       └── scopes.ts
│   │
│   ├── agents/                          # @uranus/agents                                [F2]
│   │   ├── src/
│   │   │   ├── runtime.ts  registry.ts  loader.ts  validator.ts  router.ts
│   │   │   └── hooks.ts
│   │   └── catalog/                     # specs declarativas (YAML)
│   │       ├── executor.yaml            [F2]
│   │       ├── testing.yaml  reviewer.yaml  qa.yaml  security.yaml       [F5]
│   │       ├── planner.yaml  backlog-manager.yaml                        [F4]
│   │       ├── context-manager.yaml  memory-manager.yaml                 [F3]
│   │       ├── architecture.yaml  refactor.yaml  performance.yaml        [F5]
│   │       ├── documentation.yaml  dependency-manager.yaml  bug-hunter.yaml
│   │       ├── git.yaml  devops.yaml  database.yaml  api.yaml
│   │       └── backend.yaml  frontend.yaml
│   │
│   ├── prompts/                         # @uranus/prompts                               [F2]
│   │   ├── src/{registry,template,render,versioning,diff}.ts
│   │   └── templates/
│   │       ├── system/{base,executor,reviewer,planner,...}.md
│   │       ├── instruction/{implement-task,review-diff,plan-item,...}.md
│   │       └── fragments/{untrusted-wrapper,failure-diagnosis,conventions}.md
│   │
│   ├── executors/                       # @uranus/executors                             [F2]
│   │   └── src/
│   │       ├── shell/{runner,windows,posix,quoting,limits}.ts   # ADR-011
│   │       ├── sandbox/{worktree-sandbox,workspace,orphans,cleanup}.ts
│   │       ├── verifier/
│   │       │   ├── verifier.ts
│   │       │   └── checks/{command,tests,coverage,diff,artifact,schema,plugin}.ts
│   │       ├── diagnosis/{classifier,evidence,truncate}.ts
│   │       └── watcher/fs-watch.ts      # observa edições de CliProvider
│   │
│   ├── providers/                       # @uranus/providers                             [F2]
│   │   └── src/
│   │       ├── registry.ts  router.ts  circuit-breaker.ts  retry.ts  pricing.ts
│   │       ├── base/{cli-provider,api-provider,normalize,ndjson}.ts
│   │       ├── claude-code/             [F2]
│   │       ├── codex-cli/  openai-gpt/  gemini/  openrouter/            [F8]
│   │       └── cassette/{record,replay}.ts     # sessões determinísticas em teste
│   │
│   ├── vcs/                             # @uranus/vcs                                   [F2]
│   │   └── src/
│   │       ├── git/{adapter,worktree,diff,commit-message,conflicts}.ts
│   │       └── hosts/{github,gitlab,pr-template}.ts
│   │
│   ├── backlog/                         # @uranus/backlog                               [F4]
│   │   └── src/
│   │       ├── store.ts  normalizer.ts  estimator.ts
│   │       ├── plan-validator.ts        # rejeita plano inválido antes de virar task
│   │       └── sources/{yaml,markdown,github-issues,linear}.ts
│   │
│   ├── rules/                           # @uranus/rules                                 [F5]
│   │   └── src/{engine,rule,dsl,builtin}.ts
│   │
│   ├── plugins/                         # @uranus/plugins                               [F6]
│   │   └── src/
│   │       ├── loader.ts  registry.ts  manifest.ts  detect.ts
│   │       ├── context.ts               # PluginContext — única superfície exposta
│   │       ├── capability-scan.ts       # capacidade usada vs. declarada
│   │       ├── sdk.ts                   # helpers p/ autores (@uranus/plugins/sdk)
│   │       └── builtin/{node,nextjs,docker}.ts
│   │
│   ├── telemetry/                       # @uranus/telemetry                             [F7]
│   │   └── src/
│   │       ├── metrics.ts               # cardinalidade limitada + spans encadeados
│   │       ├── pricing.ts  cost.ts      # preços versionados, custo real, reconciliação
│   │       ├── accounting.ts            # eventos → contabilidade (Executor + gates + planner)
│   │       ├── aggregator.ts            # estado vivo derivado do log
│   │       └── otlp.ts
│   │
│   ├── testkit/                         # @uranus/testkit                               [F1]
│   │   └── src/
│   │       ├── fakes/{clock,logger,event-store,shell,provider,vcs}.ts
│   │       ├── fixtures/{repo,project,task,backlog}.ts
│   │       ├── contracts/               # suítes que implementadores devem passar
│   │       │   ├── provider.contract.ts  plugin.contract.ts
│   │       │   ├── memory-store.contract.ts  check-impl.contract.ts
│   │       │   └── scheduler-policy.contract.ts
│   │       └── chaos/{kill-at-phase,assert-recovery}.ts
│   │
│   ├── cli/                             # @uranus/cli — bin: `uranus`                   [F2]
│   │   └── src/
│   │       ├── main.ts
│   │       ├── commands/
│   │       │   ├── init.ts  project.ts  start.ts  stop.ts  pause.ts  resume.ts
│   │       │   ├── status.ts  logs.ts  attach.ts  doctor.ts  update.ts
│   │       │   ├── task.ts  backlog.ts  plan.ts
│   │       │   ├── memory.ts  context.ts  checkpoint.ts
│   │       │   ├── plugin.ts  provider.ts  dashboard.ts
│   │       ├── tui/                     # attach ao vivo
│   │       └── output/{table,json,spinner}.ts
│   │
│   └── dashboard/                       # @uranus/dashboard                             [F7]
│       ├── server/src/{app,routes/*,ws/stream,auth}.ts
│       └── web/src/
│           ├── pages/{now,queue,timeline,quality,cost,git,memory,approvals,health}.tsx
│           └── components/  hooks/  lib/
│
├── plugins/                             # first-party, versionados à parte
│   ├── (node/ nextjs/ docker/ vivem em packages/plugins/src/builtin/)   [F6]
│   ├── nestjs/  react/  vue/  angular/  laravel/  python/  fastapi/
│   ├── django/  go/  rust/  prisma/  supabase/  neon/  kubernetes/
│   ├── aws/  cloudflare/  gitlab/  stripe/  mercadopago/  pix/
│   └── telegram/  discord/                                              [F9]
│
├── examples/
│   ├── todo-api/                        # repo fixture do MVP                           [F2]
│   ├── nextjs-app/                      [F6]
│   └── laravel-app/                     [F6]
│
└── .uranus/                             # dogfooding: o Uranus desenvolve o Uranus      [F3]
    ├── config.yaml
    ├── memory/  backlog/  rules/
    └── (state.db, events/, runs/, workspaces/ — gitignored)
```

---

## Grafo de dependências entre pacotes

Nenhuma seta pode ser invertida. `core` não depende de ninguém; `kernel` não depende de nenhuma
implementação concreta (só de `core`) — tudo entra por injeção no composition root do `cli`.

```
                              core
                                │
        ┌──────────┬────────────┼────────────┬──────────┬──────────┐
     config     events        state      testkit    telemetry   prompts
        │          │            │                       │
        └────┬─────┴──────┬─────┘                       │
             │            │                             │
          queue      ┌────┴─────┬──────────┬────────────┤
             │    memory     context    providers   executors     vcs
             │       │          │           │            │         │
             └───────┴────┬─────┴─────┬─────┴────────────┴─────────┘
                          │           │
                      scheduler    agents ── rules ── backlog
                          │           │
                          └─────┬─────┘
                                │
                             kernel ──── plugins
                                │
                    ┌───────────┴───────────┐
                   cli                  dashboard
```

Regras verificadas em CI por lint de import:

- `kernel` **não pode** importar `providers/*/`, `plugins/*`, `executors/*` concretos — só contratos de `core`.
- `core` não pode importar nada além de tipos.
- Plugins não podem importar nada além de `@uranus/core` e `@uranus/plugins/sdk`.
