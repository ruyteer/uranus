# Uranus

> **Agentic Coding Harness Framework** — o modelo de IA é o executor; o Uranus é o controlador.

O Uranus orquestra modelos capazes de editar código (Claude Code, Codex, GPT, Gemini) para
trabalhar continuamente em projetos de software sob supervisão humana. Todo o raciocínio de
controle — o que fazer, em que ordem, com qual contexto, se deu certo — pertence a código
determinístico, não ao modelo.

**Status: em desenvolvimento — Fase 2 (MVP Kernel Loop) concluída.**
O ciclo completo funciona: task com contrato de aceite → git worktree isolado →
Claude Code implementa → verificação por testes → commit → PR — com recuperação
exata após `kill -9` em qualquer fase (provado por teste de caos no CI).

## Princípios

1. **Sucesso é provado por código.** Toda task carrega um contrato de aceite executável;
   o veredito é o exit code, nunca a autoavaliação do modelo.
2. **O modelo nunca decide fluxo.** Saída de modelo é dado; planos passam por validação
   determinística antes de virar trabalho.
3. **Todo efeito colateral é um evento.** Log append-only como fonte da verdade; estado é projeção.
4. **Todo ciclo termina em checkpoint.** Interrupção nunca perde mais de um tick.
5. **Escrita apenas em git worktree isolado.** Integração via Pull Request.
6. **Orçamento é limite duro.** USD, tokens e tempo — verificados antes de gastar.

Arquitetura completa em [docs/00-ARCHITECTURE.md](docs/00-ARCHITECTURE.md) ·
Contratos em [docs/01-CONTRACTS.md](docs/01-CONTRACTS.md) ·
Roadmap em [docs/02-ROADMAP.md](docs/02-ROADMAP.md) ·
Riscos em [docs/04-RISKS.md](docs/04-RISKS.md)

## Pacotes

| Pacote              | Descrição                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| `@uranus/core`      | Tipos, contratos e domínio. Raiz do grafo, sem I/O.                                                        |
| `@uranus/config`    | Configuração em camadas (defaults → global → projeto → env → flags) com schema.                            |
| `@uranus/events`    | Barramento tipado (observers + interceptors com veto) e event log JSONL segmentado.                        |
| `@uranus/state`     | SQLite (`node:sqlite`, sem módulo nativo), migrations, repositórios, leases com TTL, snapshot atômico.     |
| `@uranus/testkit`   | Fakes (`FakeClock`, `InMemoryEventStore`, `ScriptedProvider`), fixtures de repo git e helpers.             |
| `@uranus/executors` | `ShellRunner` cross-platform, sandbox por git worktree, `Verifier` de contratos e classificador de falhas. |
| `@uranus/vcs`       | Adaptador git (worktrees, commits, diffs) e host GitHub via `gh`.                                          |
| `@uranus/queue`     | Fila persistente com leases por arquivo, dependências e dead-letter.                                       |
| `@uranus/prompts`   | Registro de templates de prompt versionados com render estrito.                                            |
| `@uranus/providers` | Adaptador Claude Code headless (stream NDJSON normalizado) + registry com circuit breaker.                 |
| `@uranus/agents`    | Runtime único de agentes declarativos + spec do `Executor`.                                                |
| `@uranus/kernel`    | O ciclo de 10 fases: sense → select → admit → prepare → execute → verify → integrate → learn → checkpoint. |
| `@uranus/cli`       | `uranus init · task add · start · status · logs · doctor`.                                                 |

## Uso rápido

```bash
cd meu-projeto            # um repositório git
uranus init               # cria .uranus/config.yaml
uranus doctor             # valida git, claude CLI, gh
uranus task add --file task.yaml
uranus start              # trabalha até drenar a fila; Ctrl+C + --resume retoma
```

Exemplo completo em [examples/todo-api](examples/todo-api).

## Desenvolvimento

Requisitos: Node ≥ 22, pnpm ≥ 9. Windows e Linux são cidadãos de primeira classe.

```bash
pnpm install
pnpm check        # typecheck + lint + testes
pnpm coverage     # com gates de cobertura (core/state >= 90%)
```

## Licença

Apache-2.0
