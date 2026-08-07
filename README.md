# Uranus

> **Agentic Coding Harness Framework** — o modelo de IA é o executor; o Uranus é o controlador.

O Uranus orquestra modelos capazes de editar código (Claude Code, Codex, GPT, Gemini) para
trabalhar continuamente em projetos de software sob supervisão humana. Todo o raciocínio de
controle — o que fazer, em que ordem, com qual contexto, se deu certo — pertence a código
determinístico, não ao modelo.

**Status: em desenvolvimento — Fase 1 (Fundação) concluída.** Ainda não executa tarefas.

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

| Pacote | Descrição |
|---|---|
| `@uranus/core` | Tipos, contratos e domínio. Raiz do grafo, sem I/O. |
| `@uranus/config` | Configuração em camadas (defaults → global → projeto → env → flags) com schema. |
| `@uranus/events` | Barramento tipado (observers + interceptors com veto) e event log JSONL segmentado. |
| `@uranus/state` | SQLite (`node:sqlite`, sem módulo nativo), migrations, repositórios, leases com TTL, snapshot atômico. |
| `@uranus/testkit` | Fakes (`FakeClock`, `InMemoryEventStore`), fixtures e suítes de contrato. |

## Desenvolvimento

Requisitos: Node ≥ 22, pnpm ≥ 9. Windows e Linux são cidadãos de primeira classe.

```bash
pnpm install
pnpm check        # typecheck + lint + testes
pnpm coverage     # com gates de cobertura (core/state >= 90%)
```

## Licença

Apache-2.0
