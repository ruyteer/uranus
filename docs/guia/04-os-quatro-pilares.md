# 4. Os quatro pilares

← [Como o Uranus treina o Claude](03-como-treina-o-claude.md) · Próximo: [Memória, backlog e vault](05-memoria-e-backlog.md) →

O objetivo do Uranus é ensinar o Claude a trabalhar da forma mais **econômica**, **eficiente**,
**segura** e **escalável** possível. Esta página mostra, para cada pilar, o que o Uranus faz de
concreto — sem promessa vaga.

> **Dois modos de uso.** O modo do dia a dia é o `uranus chat`: o Claude Code conduz o trabalho,
> seguindo as regras que o Uranus escreveu para ele. Existe também um **modo automático avançado**
> (o _kernel_), em que o Uranus controla o ciclo inteiro sozinho, com orçamento e verificação por
> código. Onde um mecanismo vale só para o modo automático, a tabela indica.

---

## 💰 Econômico

_Gastar o mínimo de tokens para chegar ao resultado._

| Mecanismo                                          | Como economiza                                                                                                                                                                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Modelo certo para cada tarefa**                  | Os agentes têm modelo fixo: `haiku` (barato) para explorar, documentar, mexer em git e dependências; `opus` (caro) só para planejar e caçar bug difícil. A regra no `CLAUDE.md` é explícita: _não chame `opus` para o que `haiku` resolve_. |
| **`context-scout` antes de explorar**              | Em vez de um agente caro ler dezenas de arquivos, um agente `haiku` faz o reconhecimento e devolve um resumo curto.                                                                                                                         |
| **Memória em vez de redescoberta**                 | Decisões e convenções gravadas não precisam ser deduzidas de novo lendo o código a cada sessão.                                                                                                                                             |
| **Grafo de contexto (graphify)**                   | Quando existe, o Claude consulta o grafo do código em vez de reabrir arquivo por arquivo.                                                                                                                                                   |
| **Análise do projeto em cache**                    | Stack, testes e CI são detectados uma vez e reaproveitados (`uranus context show`).                                                                                                                                                         |
| **Teste de UI pela árvore de acessibilidade**      | O `agent-browser` lê a página como lista de elementos, bem menor que o HTML cru.                                                                                                                                                            |
| **Orçamento como limite duro** _(modo automático)_ | Tokens, custo, tempo e tentativas **param** a execução ao estourar — não só avisam.                                                                                                                                                         |

## ⚡ Eficiente

_Não refazer trabalho, não reexplicar, paralelizar o que dá._

| Mecanismo                                               | Como acelera                                                                                                                  |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Planejar antes de fazer**                             | O `planner` quebra o pedido em subtasks pequenas, cada uma do tamanho de um especialista, e diz o que pode rodar em paralelo. |
| **Subagentes em paralelo**                              | Subtasks que não mexem nos mesmos arquivos são despachadas ao mesmo tempo.                                                    |
| **Especialistas com foco**                              | Cada agente recebe só o que precisa para a função dele, em vez de uma sessão carregando o projeto inteiro.                    |
| **Backlog como fila única**                             | Os pedidos ficam num lugar só, com progresso e subtasks — nada se perde em conversas soltas.                                  |
| **Revisão no fim de cada subtask**                      | O `reviewer` pega problema cedo, quando corrigir ainda é barato.                                                              |
| **Verificação por código primeiro** _(modo automático)_ | Testes, lint e tipos rodam antes de qualquer revisão por IA: não se gasta token revisando código que nem compila.             |

## 🛡️ Seguro

_Não estragar o projeto, não vazar segredos, você sempre no controle._

| Mecanismo                                     | Como protege                                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Nunca apaga o que é seu**                   | No `CLAUDE.md`, só o trecho entre marcadores é do Uranus; agentes e hooks seus são preservados.                                             |
| **Tudo local e legível**                      | Memória, backlog e configuração são arquivos em `.uranus/`, no seu computador, que você pode ler, editar e versionar.                       |
| **Revisão de segurança obrigatória**          | Qualquer mudança que toque autenticação, dados ou entrada externa passa pelo agente `security`.                                             |
| **Painel fechado por padrão**                 | Só escuta em `127.0.0.1`. Para expor em rede, o servidor exige um token e se recusa a subir sem ele.                                        |
| **Plugins com permissão mínima**              | Cada plugin declara se precisa de arquivos, rede ou execução de comandos; o padrão é negar. `uranus plugin check` audita antes de instalar. |
| **Segredos mascarados**                       | Telemetria, logs e painel escondem segredos automaticamente.                                                                                |
| **Conteúdo externo é dado, não ordem**        | Um comentário no código dizendo "ignore os testes" não vira instrução (defesa contra _prompt injection_).                                   |
| **Trabalho isolado e PR** _(modo automático)_ | Cada tarefa roda numa cópia isolada do repositório (`git worktree`), nunca direto na branch principal; integra via Pull Request.            |
| **Aprovação humana** _(modo automático)_      | Merge na branch principal, `push --force`, mudança em CI/secrets, migration destrutiva e dependência nova exigem você.                      |

## 📈 Escalável

_Funcionar igual em projeto pequeno e em monorepo gigante._

| Mecanismo                                             | Como escala                                                                                                                                          |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Instruções por pasta**                              | Instruções com escopo viram um `CLAUDE.md` naquela pasta; o Claude lê o mais próximo de onde está mexendo.                                           |
| **Memória com escopos e compactação**                 | A memória é separada por tipo (arquitetura, decisão, bug, convenção...) e `uranus memory compact` revalida e resume escopos cheios.                  |
| **Vault de conhecimento**                             | Memória, backlog e instruções se ligam por `[[links]]`, formando um grafo navegável em vez de uma pilha de notas.                                    |
| **Plugins por stack**                                 | O núcleo não conhece npm, Next.js ou Docker; plugins ativam sozinhos conforme o projeto. Uma stack nova é um plugin novo, não uma mudança no núcleo. |
| **Projetos vizinhos**                                 | Um projeto pode registrar pedidos no backlog de outro relacionado (ex.: o front pedindo uma rota ao back).                                           |
| **Limite de sessões simultâneas** _(modo automático)_ | Controla quantas sessões de modelo rodam ao mesmo tempo por provedor.                                                                                |

---

Quer o raciocínio completo por trás de cada decisão? Veja os invariantes e ADRs na
[documentação de arquitetura](../00-ARCHITECTURE.md).

← [Como o Uranus treina o Claude](03-como-treina-o-claude.md) · Próximo: [Memória, backlog e vault](05-memoria-e-backlog.md) →
