# 7. Referência de comandos

← [O painel web](06-painel.md) · Próximo: [Configuração e plugins](08-configuracao-e-plugins.md) →

Todo comando aceita `--help` para ver as opções.

## Os cinco que você mais vai usar

| Comando                         | O que faz                                        |
| ------------------------------- | ------------------------------------------------ |
| `uranus init`                   | Liga o Uranus no projeto atual                   |
| `uranus backlog add "<pedido>"` | Adiciona um pedido                               |
| `uranus chat`                   | Abre o Claude Code já treinado no projeto        |
| `uranus dashboard`              | Abre o painel web                                |
| `uranus doctor`                 | Diz o que está faltando quando algo não funciona |

## Projeto

| Comando                 | O que faz                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `uranus init`           | Cria `.uranus/` e gera o `CLAUDE.md`. Aceita `--name` e `--yes`.                                  |
| `uranus doctor`         | Verifica Node, git, Claude Code e a configuração.                                                 |
| `uranus claude`         | Regenera `.claude/` (CLAUDE.md, agentes, hooks) sem passar pelo `init`.                           |
| `uranus chat [args...]` | Abre o Claude Code treinado. Argumentos extras vão direto para o `claude` (ex.: `--resume <id>`). |
| `uranus dashboard`      | Sobe o painel. Aceita `--port` e `--host`.                                                        |

## Backlog

| Comando                               | O que faz                                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `uranus backlog add "<título>"`       | Adiciona um item. Aceita `--body`, `--label`, `--priority` (0–100, padrão 50), `--image` e `--suggestion`. |
| `uranus backlog list`                 | Lista os itens com o progresso.                                                                            |
| `uranus backlog show <id>`            | Mostra um item completo: corpo, plano e subtasks.                                                          |
| `uranus backlog status <id> <estado>` | Muda o estado (`open`, `planned`, `done`, `dropped`).                                                      |
| `uranus backlog import <arquivo.md>`  | Importa itens de um Markdown.                                                                              |

## Memória e contexto

| Comando                      | O que faz                                                |
| ---------------------------- | -------------------------------------------------------- |
| `uranus memory list`         | Lista as memórias ativas. Aceita `--scope`.              |
| `uranus memory show <id>`    | Mostra uma memória completa.                             |
| `uranus memory add [título]` | Grava uma memória. Aceita `--scope`, `--body`, `--tags`. |
| `uranus memory compact`      | Revalida e compacta escopos cheios.                      |
| `uranus vault`               | Mostra como memória, backlog e instruções se ligam.      |
| `uranus context show`        | Mostra a análise do projeto: stack, testes, CI.          |
| `uranus context rebuild`     | Refaz essa análise do zero, ignorando o cache.           |

## Configuração e validações

| Comando                               | O que faz                                       |
| ------------------------------------- | ----------------------------------------------- |
| `uranus config`                       | Assistente de configuração, com perguntas.      |
| `uranus config show`                  | Configuração efetiva e de onde veio cada valor. |
| `uranus config set <caminho> <valor>` | Muda um valor direto.                           |
| `uranus validations`                  | Quais validações rodam e com que severidade.    |

## Plugins

| Comando                     | O que faz                                     |
| --------------------------- | --------------------------------------------- |
| `uranus plugin list`        | Quais plugins ativaram, quais não, e por quê. |
| `uranus plugin info <id>`   | Manifesto e permissões de um plugin.          |
| `uranus plugin check <dir>` | Audita um plugin antes de instalar.           |

---

← [O painel web](06-painel.md) · Próximo: [Configuração e plugins](08-configuracao-e-plugins.md) →
