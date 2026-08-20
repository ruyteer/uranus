Quebre este plano completo em pequenas tarefas, para cada grande categoria que citei aqui. 
Distribua essas tarefas entre múltiplos agentes, cada um com sua devida função. 
Comece com 1 cateogria por vez. 

A única coisa que deve se preocupar é com o uso limite da sessão. QUando estiver perto de esgotar, por volta de uns 75%, pare de gerar e guarde o contexto de onde parou para retomar depois. 

Crie subagentes para desenvolver e testar, cada um com uma responsabilidade. E você fique como orquestrador desses agentes. Isso na hora de fazer o que citei nos outros .md

Escolha a prioridade das tarefas de acordo com o que for mais urgente de necessidade na sua visão, mas quero que implemente tudo que foi pedido, sem deixar nada faltando.

A arquitetura do uranus segue DDD (Domain-Driven Design). Pense no domínio primeiro sempre — qual
entidade, qual agregado, qual invariante — antes de escrever código de infraestrutura. Detalhe
completo em `docs/00-ARCHITECTURE.md` (ADR-013) e em `CLAUDE.md` na raiz.

Quando terminar as tarefas que tinha em mãos, não considere o trabalho encerrado — volte e confira
se apareceu tarefa nova aqui no backlog antes de parar. Isso é a mesma regra que o kernel já segue
em runtime (fila drenada não é fim de run, ele tenta planejar mais um item do backlog antes de
encerrar — `planFromBacklog` em `packages/kernel/src/kernel.ts`); vale igual pra você trabalhando
neste repo.
