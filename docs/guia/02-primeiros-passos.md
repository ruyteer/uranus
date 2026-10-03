# 2. Primeiros passos

← [O que é o Uranus](01-o-que-e.md) · Próximo: [Como o Uranus treina o Claude](03-como-treina-o-claude.md) →

Nesta página você instala o Uranus, liga num projeto seu e faz o Claude trabalhar no primeiro
pedido. Leva uns 10 minutos.

## O que você precisa ter instalado

| Ferramenta                                    | Versão            | Para quê                                 | Como conferir      |
| --------------------------------------------- | ----------------- | ---------------------------------------- | ------------------ |
| [Node.js](https://nodejs.org)                 | 22 ou mais nova   | Roda o Uranus                            | `node --version`   |
| [pnpm](https://pnpm.io)                       | qualquer recente  | Instala as dependências                  | `pnpm --version`   |
| [git](https://git-scm.com)                    | 2.20 ou mais nova | O projeto precisa ser um repositório git | `git --version`    |
| [Claude Code](https://claude.com/claude-code) | —                 | É ele quem programa                      | `claude --version` |
| [gh](https://cli.github.com) _(opcional)_     | —                 | Abrir Pull Requests automaticamente      | `gh --version`     |

## Passo 1 — Instalar o Uranus

```bash
git clone https://github.com/ruyteer/uranus.git
cd uranus
pnpm install
pnpm build
```

Deixe o comando `uranus` disponível em qualquer pasta do computador:

```bash
cd packages/cli
npm link
```

Faça login no Claude Code (só na primeira vez):

```bash
claude /login
```

E confira se está tudo certo:

```bash
uranus doctor
```

O `doctor` verifica Node, git, Claude Code e a configuração, e diz o que falta se algo der errado.

## Passo 2 — Ligar o Uranus no seu projeto

Entre na pasta do **seu** projeto (não na do Uranus) e rode:

```bash
cd ~/meu-projeto
uranus init
```

O que acontece:

1. O Uranus faz algumas perguntas simples (nome do projeto etc.). Use `uranus init --yes` para
   aceitar tudo no padrão.
2. Cria a pasta `.uranus/`, onde vão morar a memória, o backlog e a configuração. Ela já fica
   ignorada pelo git do seu projeto.
3. Analisa o projeto (linguagens, frameworks, como rodar os testes).
4. Gera o `CLAUDE.md` e os agentes em `.claude/agents/` — o "manual" que o Claude lê ao abrir.
   Se você já tinha um `CLAUDE.md`, o seu conteúdo é preservado.

## Passo 3 — Fazer o primeiro pedido

Pedidos vão para o **backlog**, em texto livre, do jeito que você explicaria para uma pessoa:

```bash
uranus backlog add "Adicionar exportação em CSV" \
  --body "O relatório hoje só exporta PDF. Quero também CSV, com as mesmas colunas."
```

Confira:

```bash
uranus backlog list
```

## Passo 4 — Colocar o Claude para trabalhar

```bash
uranus chat
```

Isso abre o Claude Code normal — mesma tela, mesmo custo de rodar `claude` direto — só que já
vestindo a armadura. Experimente pedir:

> Olhe o backlog e trabalhe no item de exportação em CSV.

O Claude vai ler o item, chamar o agente `planner` para quebrar em partes, delegar para os
especialistas, revisar e, no fim, gravar na memória o que aprendeu.

## Passo 5 — Acompanhar pelo navegador

Em outro terminal, na pasta do projeto:

```bash
uranus dashboard
```

Abra <http://localhost:4319>. Você vê o backlog com o progresso, a memória gravada, o git e uma
sala ao vivo com o Claude e os subagentes trabalhando. Detalhes em [O painel web](06-painel.md).

## E depois?

- Continue adicionando itens no backlog e abrindo `uranus chat`. Cada sessão começa sabendo o que
  as anteriores aprenderam.
- Quer entender o que o Claude recebe ao abrir? Leia
  [Como o Uranus treina o Claude](03-como-treina-o-claude.md).
- Algo deu errado? Veja [Problemas comuns](09-problemas-comuns.md).

---

← [O que é o Uranus](01-o-que-e.md) · Próximo: [Como o Uranus treina o Claude](03-como-treina-o-claude.md) →
