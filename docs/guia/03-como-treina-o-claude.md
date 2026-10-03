# 3. Como o Uranus treina o Claude

← [Primeiros passos](02-primeiros-passos.md) · Próximo: [Os quatro pilares](04-os-quatro-pilares.md) →

O Claude Code, ao abrir uma sessão numa pasta, lê sozinho alguns arquivos: o `CLAUDE.md` (as
instruções do projeto), `.claude/agents/` (os especialistas que ele pode chamar), `.claude/skills/`
(conhecimentos especializados) e `.claude/settings.json` (hooks e permissões). **O Uranus escreve esses arquivos por você**, e os
mantém atualizados a cada `uranus init`, `uranus claude` e `uranus chat`.

É isso que chamamos de treinar: o Claude chega no projeto já sabendo como trabalhar ali.

```mermaid
flowchart LR
    subgraph Fontes[".uranus/ · o que o Uranus sabe"]
        direction TB
        D["🔍 Análise do projeto<br/><small>stack, testes, CI</small>"]
        I["📜 Instruções<br/><small>regras que você escreveu</small>"]
        M["🧠 Memória<br/><small>decisões, convenções, bugs</small>"]
        B["📋 Backlog<br/><small>pedidos</small>"]
    end
    G{{"⚙️ uranus init · chat"}}
    subgraph Claude[".claude/ · o que o Claude lê ao abrir"]
        direction TB
        C["📘 CLAUDE.md<br/><small>manual do projeto</small>"]
        A["🤖 agents/uranus-*.md<br/><small>12 especialistas</small>"]
        S["🎬 skills/uranus-*<br/><small>conhecimento embarcado</small>"]
        H["🔌 settings.json<br/><small>hooks para o painel</small>"]
    end
    D --> G
    I --> G
    M -.-> G
    B -.-> G
    G --> C
    G --> A
    G --> S
    G --> H

    classDef fonte fill:#eef4ff,stroke:#2f81f7,color:#1f2328
    classDef gen fill:#6d5dfc,stroke:#6d5dfc,color:#ffffff
    classDef alvo fill:#fdf1ec,stroke:#d97757,color:#1f2328
    class D,I,M,B fonte
    class G gen
    class C,A,S,H alvo
    style Fontes fill:transparent,stroke:#2f81f7,stroke-dasharray:4 4
    style Claude fill:transparent,stroke:#d97757,stroke-dasharray:4 4
```

As setas cheias são o que entra no conteúdo gerado; as pontilhadas são o que o `CLAUDE.md` só aponta
(onde fica e como usar) — a memória e o backlog o Claude lê direto, durante a sessão.

## O que vai no `CLAUDE.md`

A parte que o Uranus gera fica entre marcadores (`<!-- URANUS:BEGIN -->` … `<!-- URANUS:END -->`).
**Tudo que você escrever fora deles nunca é tocado.** Dentro, o Claude recebe:

| Seção                  | O que ensina                                                                  |
| ---------------------- | ----------------------------------------------------------------------------- |
| Visão do projeto       | Linguagens, frameworks e comando de teste detectados automaticamente          |
| Backlog                | Onde estão os pedidos e como marcar um item como feito/descartado             |
| Memória                | Ler `.uranus/memory/` antes de assumir um padrão, e gravar o que aprender     |
| Catálogo de agentes    | Quem são os especialistas e quando chamar cada um                             |
| Regras de despacho     | Paralelizar, usar o modelo mais barato que resolve, revisar antes de entregar |
| Skills                 | Conferir se falta uma skill antes de tarefas fora do comum                    |
| Conhecimento embarcado | As skills que vêm com o Uranus (ex.: vídeo e motion) e quando usar cada uma   |
| Teste no navegador     | Validar interfaces web abrindo de verdade, não só relendo o código            |
| Instruções do projeto  | As regras que você cadastrou (pelo painel ou em `.uranus/instructions/`)      |

Instruções com escopo de pasta viram um `CLAUDE.md` dentro daquela pasta — útil em monorepos,
porque o Claude Code lê o `CLAUDE.md` mais próximo de onde está mexendo.

## Os agentes especialistas

Em vez de uma única sessão fazendo tudo com o modelo mais caro, o Claude vira um **orquestrador**
que delega para especialistas. Cada um tem uma função e um "tamanho" de modelo escolhido a dedo:

| Agente          | Modelo | Função                                                   |
| --------------- | ------ | -------------------------------------------------------- |
| `planner`       | opus   | Quebra um pedido em subtasks e decide quem faz o quê     |
| `context-scout` | haiku  | Explora uma área do código e devolve um resumo curto     |
| `backend`       | sonnet | Implementação de servidor, APIs, regras de negócio       |
| `frontend`      | sonnet | Interface, componentes, estilos                          |
| `database`      | sonnet | Schema, migrations, queries                              |
| `refactor`      | sonnet | Melhorar código sem mudar o comportamento                |
| `bug-hunter`    | opus   | Investigar falhas difíceis até a causa raiz              |
| `reviewer`      | sonnet | Revisar o que foi feito antes de dar como pronto         |
| `security`      | sonnet | Revisar autenticação, dados sensíveis, entradas externas |
| `docs`          | haiku  | Documentação                                             |
| `deps`          | haiku  | Dependências                                             |
| `git-release`   | haiku  | Commits, branches, releases                              |

> **Por que três modelos?** `opus` é o mais capaz e o mais caro; `haiku` é rápido e barato.
> Raciocínio difícil (planejar, caçar bug) vai para `opus`; trabalho mecânico (explorar, documentar,
> mexer em git) vai para `haiku`; o dia a dia fica com `sonnet`. Veja o impacto disso em
> [Os quatro pilares](04-os-quatro-pilares.md#-econômico).

Os arquivos ficam em `.claude/agents/uranus-*.md`. Um agente que você escrever à mão com outro nome
nunca é sobrescrito.

## Conhecimento embarcado

Além dos agentes, o Uranus instala **skills**: manuais de trabalhos especializados, escritos a
partir de produções reais (o que foi aprovado, o que foi reprovado, os parâmetros que funcionaram).
Ficam em `.claude/skills/uranus-*/`, e o Claude Code carrega cada uma sozinho quando o pedido bate
com o assunto.

| Skill                 | Ensina o Claude a                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| `uranus-motion-video` | Produzir e editar vídeo com os materiais do projeto — veja [Vídeo e motion](10-video-e-motion.md) |

Como os agentes, só as pastas com prefixo `uranus-` são do Uranus; uma skill sua com outro nome
nunca é tocada.

## O ciclo de aprendizado

O treino não é uma vez só. Ele melhora a cada sessão:

```mermaid
flowchart LR
    A(["📋 Você adiciona<br/>um pedido"]) --> B["📘 uranus chat<br/><small>Claude lê CLAUDE.md,<br/>memória e backlog</small>"]
    B --> C["🛠️ Planeja, delega<br/>e implementa"]
    C --> D["🔎 reviewer · security<br/>conferem"]
    D --> E["🧠 Grava o que<br/>aprendeu"]
    E -. "próxima sessão<br/>começa sabendo mais" .-> B

    classDef voce fill:#eef4ff,stroke:#2f81f7,color:#1f2328
    classDef claude fill:#fdf1ec,stroke:#d97757,color:#1f2328
    classDef mem fill:#f3ecff,stroke:#a371f7,color:#1f2328
    class A voce
    class B,C,D claude
    class E mem
```

A primeira sessão num projeto novo já é melhor que o `claude` puro (o Claude sabe a stack e como
se organizar). A décima é muito melhor, porque a memória acumulou as decisões, preferências e
armadilhas daquele projeto.

## Hooks: o Claude avisando o que está fazendo

O Uranus registra quatro hooks no `.claude/settings.json` (`UserPromptSubmit`, `Stop`,
`SubagentStart`, `SubagentStop`). Eles só enviam um aviso para o painel quando uma etapa começa ou
termina — é isso que alimenta a visualização ao vivo. Hooks que você já tinha são preservados.

---

← [Primeiros passos](02-primeiros-passos.md) · Próximo: [Os quatro pilares](04-os-quatro-pilares.md) →
