# Uranus — instruções do projeto

Este repositório é o próprio framework Uranus (não um projeto gerenciado *por*
Uranus). Contexto completo: `docs/00-ARCHITECTURE.md` (arquitetura, ADRs,
invariantes), `docs/02-ROADMAP.md` (fases) e `backlog/*.md` — pedidos de
feature em texto livre, um arquivo por tema; `backlog/importante.md` guarda as
regras de processo (orçamento de sessão, delegação a subagentes).

## Metodologia: Domain-Driven Design

Pense no domínio primeiro, sempre. Antes de tocar em scheduler, handler, rota
de dashboard ou schema de banco, pare e responda: qual é o conceito de
domínio aqui, qual entidade/agregado ele pertence, qual invariante ele
protege, qual módulo é o dono dele (ver a tabela de responsabilidade única em
`docs/00-ARCHITECTURE.md` §6 e o modelo de domínio em §5). Implementação é a
etapa depois disso, não o primeiro rascunho.

Na prática:

- Nomeie no código o que já tem nome no domínio (`Task`, `Attempt`,
  `AcceptanceContract`, `BacklogItem`, `MemoryRecord`...) — não invente
  sinônimo novo pra um conceito que já existe.
- Um `if` que menciona uma tecnologia dentro do `kernel` está no lugar errado
  (INV-8) — é sintoma de ter pulado a modelagem de domínio e ido direto pro
  código.
- Ao adicionar uma feature nova, primeiro decida a que Bounded Context ela
  pertence (`kernel`, `backlog`, `memory`, `context`, `plugins`...) antes de
  decidir em que arquivo ela vai.

## Backlog: nunca considere o trabalho terminado sem checar de novo

Ao esgotar as tarefas que você tinha em mãos — seja a fila de tasks de um
projeto gerenciado, seja os itens de `backlog/*.md` deste próprio repo —
**volte e confira se apareceu item novo antes de encerrar**. Isso já é
comportamento do kernel em runtime (`planFromBacklog` em
`packages/kernel/src/kernel.ts`: fila drenada não é sinônimo de fim de run,
primeiro tenta planejar mais um item do backlog); a mesma regra vale para
mim/você trabalhando neste repo — terminar os itens visíveis não é o fim,
é o sinal para reler `backlog/` e ver se o humano adicionou algo enquanto
você trabalhava.
