A dashboard não deve ser apenas leitura, ela também deve ser escrita e gerenciamento das features do uranus. 
Assim como dito em todas as outras tarefas deste backlog, tudo deve ser gerenciado pela dashboard assim como é pelo CLI, justamente pra facilitar a usabilidade pra usuários com mais dificuldade. 

Além disso, melhore o design do uranus. Utilize os projetos que vou listar como caminho abaixo como referência de design, fontes e componentes:

D:\7store
G:\Trabalho\orionbot\ui
D:\sete-bot\src\tutorial

Utilize as cores preto e branco neve pra esse projeto, com fonte poppins. 

Também melhore a exibição de métricas e dados, não exiba dados crus, trate-os. Se o status tá salvo como "done, blocked, ready", na dashboard vc traduz, deixa mais bonito e mais explicado. Cada aba deve ter metricas e dados mais fáceis de ler. 

Por último, abra a dashboard e realize testes, tanto de visualização de métricas, quanto de cruds presentes. 
Teste tudo, e só então termine. 

Também: a dashboard não atualiza em tempo real quando o uranus mexe na memória (`.uranus/memory/`).
Hoje só vejo as anotações novas se eu desligar o processo da dashboard e ligar de novo — nem
recarregar a página resolve. Isso não devia acontecer: se o uranus (`uranus start`, `uranus chat`
ou qualquer outro processo escrevendo na mesma pasta do projeto) grava uma memória nova, a aba
Memória tem que refletir isso sem eu precisar reiniciar o painel inteiro.

