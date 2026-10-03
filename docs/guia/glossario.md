# Glossário

← [Índice do guia](README.md)

| Termo                                  | O que significa                                                                                                                                |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Agente / subagente**                 | Uma instância do Claude com uma função só (planejar, revisar, mexer no banco...). O Claude principal delega para eles.                         |
| **Backlog**                            | A fila de pedidos do projeto, em `.uranus/backlog/`.                                                                                           |
| **Claude Code**                        | O assistente de programação da Anthropic que roda no terminal. É quem escreve o código.                                                        |
| **`CLAUDE.md`**                        | Arquivo de instruções que o Claude Code lê sozinho ao abrir uma pasta. O Uranus gera a parte dele.                                             |
| **Escopo (de memória)**                | O tipo de uma memória: decisão, convenção, bug, arquitetura...                                                                                 |
| **Hook**                               | Um comando que o Claude Code dispara em certos momentos (ex.: quando um subagente termina). O Uranus usa para alimentar o painel.              |
| **Instrução**                          | Uma regra fixa que você quer que o Claude siga sempre. Entra no `CLAUDE.md`.                                                                   |
| **Kernel / modo automático**           | O motor do Uranus que conduz tarefas sozinho, com orçamento e verificação por código. Hoje é recurso avançado; o uso padrão é o `uranus chat`. |
| **Memória**                            | Notas em Markdown que o Claude grava e relê entre sessões, em `.uranus/memory/`.                                                               |
| **Modelo (`haiku`, `sonnet`, `opus`)** | Os "tamanhos" do Claude: `haiku` é rápido e barato, `opus` é o mais capaz e caro, `sonnet` fica no meio.                                       |
| **Painel / dashboard**                 | A interface web do Uranus, em `http://localhost:4319`.                                                                                         |
| **Plugin**                             | Extensão que ensina o Uranus sobre uma stack (Node, Next.js, Docker...).                                                                       |
| **Prompt injection**                   | Tentativa de enganar a IA escondendo ordens em arquivos, issues ou páginas. O Uranus trata esse conteúdo como dado, não como ordem.            |
| **Skill**                              | Um pacote de instruções que dá ao Claude Code uma habilidade nova (gerar PDF, design...).                                                      |
| **Token**                              | A unidade em que o uso de modelos de IA é medido e cobrado. Menos tokens = mais barato.                                                        |
| **Vault**                              | O grafo que liga memória, backlog e instruções através de `[[links]]`.                                                                         |
| **Worktree**                           | Uma cópia de trabalho isolada do repositório git, usada no modo automático para não mexer na branch principal.                                 |
