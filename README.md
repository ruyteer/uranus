# Uranus

Uranus é armadura para o Claude Code, não um substituto dele. Quem programa é o Claude. O Uranus
dá a ele memória que sobrevive entre sessões, um backlog organizado, instruções específicas do seu
projeto e um painel web para você acompanhar e controlar tudo em tempo real.

Hoje o Uranus foca só no Claude Code. Outros modelos (Codex, GPT, Gemini, modelos locais) ainda
existem no código como suporte avançado, mas não são o caminho recomendado.

**Status:** funcional e em uso ativo. O fluxo principal é `uranus init`, depois `uranus chat` para
trabalhar com o Claude, e `uranus dashboard` para acompanhar tudo pelo navegador.

---

## Índice

1. [O que o Uranus faz](#o-que-o-uranus-faz)
2. [Instalação](#instalação)
3. [Começando](#começando)
4. [Comandos](#comandos)
5. [O painel web](#o-painel-web)
6. [Memória e backlog](#memória-e-backlog)
7. [Configuração](#configuração)
8. [Plugins](#plugins)
9. [Solução de problemas](#solução-de-problemas)
10. [Desenvolvendo o Uranus](#desenvolvendo-o-uranus)

---

## O que o Uranus faz

Rodar `claude` puro num projeto funciona, mas cada sessão começa do zero: o Claude não lembra do
que decidiu ontem, não tem um backlog organizado para trabalhar, e você não tem uma visão fácil do
que está acontecendo.

O Uranus resolve isso com quatro peças:

1. **Memória.** Fica salva em `.uranus/memory/`, em Markdown legível. O próprio Claude grava o que
   aprende durante a sessão (uma decisão, uma convenção do projeto, um bug recorrente), e essa
   memória volta a aparecer nas sessões seguintes.
2. **Backlog.** Uma lista de pedidos em texto livre, em `.uranus/backlog/`. Você escreve o que
   quer, o Claude lê e trabalha em cima disso.
3. **Instruções e treino do Claude.** O comando `uranus init` (e `uranus claude`) gera um
   `CLAUDE.md` e agentes personalizados para o seu projeto, então o Claude já entende a stack, as
   convenções e o que você já pediu antes de você digitar a primeira mensagem.
4. **Painel web.** Mostra o backlog, a memória, o histórico de instruções, git, e uma visualização
   ao vivo do que o Claude (e os subagentes que ele cria) estão fazendo.

Nada disso troca de lugar com o Claude: ele continua decidindo como resolver cada problema. O
Uranus só garante que ele tenha o contexto certo e que você consiga ver e ajustar o que ele faz.

---

## Instalação

Você precisa de Node 22 ou mais recente, git 2.20 ou mais recente, e o
[Claude Code CLI](https://claude.com/claude-code) autenticado. O `gh` (GitHub CLI) é opcional: sem
ele, os commits ficam numa branch local em vez de virarem Pull Request automaticamente.

```bash
git clone https://github.com/ruyteer/uranus.git
cd uranus
pnpm install
pnpm build
```

Deixe o comando `uranus` disponível em qualquer lugar do seu computador:

```bash
cd packages/cli
npm link
```

Autentique o Claude Code (só precisa fazer isso uma vez):

```bash
claude /login
```

Confirme que tudo está funcionando:

```bash
uranus doctor
```

---

## Começando

### 1. Inicialize no seu projeto

O projeto precisa ser um repositório git.

```bash
cd meu-projeto
uranus init
```

Isso cria a pasta `.uranus/` (já ignorada pelo git do seu projeto) e gera o `CLAUDE.md` que o
Claude vai ler. No terminal, o comando pergunta algumas coisas básicas sobre o projeto. Se quiser
pular as perguntas, use `uranus init --yes`.

### 2. Descreva o que você quer

```bash
uranus backlog add "Adicionar exportação em CSV" --body "O relatório hoje só exporta PDF. Quero também CSV, com as mesmas colunas."
```

### 3. Converse com o Claude

```bash
uranus chat
```

Isso abre uma sessão normal do Claude Code, com o mesmo custo e a mesma interface de rodar `claude`
direto, mas já treinado com o contexto do seu projeto e do seu backlog. Peça para ele olhar o
backlog, escolher um item e trabalhar nele.

### 4. Acompanhe pelo painel

```bash
uranus dashboard
```

Abre em `http://localhost:4319`. Você vê o backlog, a memória gravada, o histórico do git, e uma
visualização ao vivo do que o Claude está fazendo.

---

## Comandos

### Projeto

| Comando | O que faz |
| --- | --- |
| `uranus init` | Cria `.uranus/` e gera o `CLAUDE.md` do projeto. Aceita `--name` e `--yes`. |
| `uranus doctor` | Verifica node, git, Claude Code e a configuração. |
| `uranus claude` | Regenera `.claude/` (CLAUDE.md, agentes, hooks) sem passar pelo `init`. |
| `uranus chat [args...]` | Abre uma sessão do Claude Code já treinada neste projeto. |
| `uranus dashboard` | Sobe o painel web. Aceita `--port` e `--host`. |

### Backlog

| Comando | O que faz |
| --- | --- |
| `uranus backlog add "<título>"` | Adiciona um item. Aceita `--body`, `--label` e `--priority`. |
| `uranus backlog list` | Lista os itens com o progresso de cada um. |
| `uranus backlog show <id>` | Mostra um item completo: corpo, plano e subtasks. |
| `uranus backlog status <id> <estado>` | Muda o estado de um item à mão. |
| `uranus backlog import <arquivo.md>` | Importa itens de um arquivo Markdown. |

O backlog fica em `.uranus/backlog/*.yaml`. Você pode editar esses arquivos direto se preferir.

### Memória e contexto

| Comando | O que faz |
| --- | --- |
| `uranus memory list` | Lista as memórias ativas. Aceita `--scope`. |
| `uranus memory show <id>` | Mostra uma memória completa. |
| `uranus memory add [título]` | Grava uma memória à mão. Aceita `--scope`, `--body`, `--tags`. |
| `uranus memory compact` | Revalida e compacta escopos de memória cheios. |
| `uranus vault` | Mostra como memória, backlog e instruções se referenciam entre si. |
| `uranus context show` | Mostra o resumo automático do projeto: stack, testes, CI. |
| `uranus context rebuild` | Reconstrói esse resumo do zero, ignorando o cache. |

A memória fica em `.uranus/memory/<escopo>/*.md`, em Markdown legível. Editar à mão funciona: o
Uranus detecta a edição e respeita a sua correção.

### Configuração e validações

| Comando | O que faz |
| --- | --- |
| `uranus config show` | Mostra a configuração efetiva e de onde veio cada valor. |
| `uranus config set <caminho> <valor>` | Muda um valor direto, sem passar pelo assistente. |
| `uranus config` (sem argumento) | Abre o assistente de configuração, guiado por perguntas. |
| `uranus validations` | Mostra quais validações rodam, com que severidade. |

### Plugins

| Comando | O que faz |
| --- | --- |
| `uranus plugin list` | Mostra quais plugins ativaram, quais não, e o motivo de cada um. |
| `uranus plugin info <id>` | Mostra o manifesto e as permissões de um plugin. |
| `uranus plugin check <dir>` | Audita um plugin antes de instalar. |

---

## O painel web

```bash
uranus dashboard
```

O painel abre em `http://localhost:4319` e reflete o estado do seu projeto em tempo real.

| Aba | O que mostra |
| --- | --- |
| Backlog | Os itens que você pediu, com progresso e subtasks. É a tela principal. |
| Terminal | Sessões de verdade do Claude ou de um shell, direto pelo navegador. |
| Instruções | Notas específicas do projeto que entram no CLAUDE.md do Claude. |
| Skills | Skills disponíveis para instalar no Claude Code. |
| Configuração | A mesma configuração do `uranus config`, pela interface web. |
| Vault | O grafo de como memória, backlog e instruções se conectam entre si. |
| Sala | Visualização ao vivo do Claude e dos subagentes trabalhando, em pixel art. |
| Memória | O que está gravado em `.uranus/memory/`. |
| Git | Commits e Pull Requests abertos, com o diff resumido. |

Por padrão, o painel só escuta em `127.0.0.1`, ou seja, no seu próprio computador. Para expor numa
rede, o servidor exige um token e se recusa a subir sem ele:

```yaml
telemetry:
  dashboard:
    host: 0.0.0.0
    token: um-token-longo-e-aleatorio
```

---

## Memória e backlog

Essas duas peças são o que faz o Claude "lembrar" do seu projeto entre sessões.

**Memória.** Durante o `uranus chat`, peça para o Claude gravar decisões importantes com
`uranus memory add`. Da próxima vez que você abrir uma sessão, essa memória já está disponível.
Existem escopos diferentes (convenção, arquitetura, preferência, e outros) para organizar o que é
relevante para qual tipo de trabalho.

**Backlog.** É a fila de pedidos, em texto livre. Escreva o que você quer com `uranus backlog add`,
e peça ao Claude para olhar o backlog e escolher o que fazer. Você também pode editar os arquivos
em `.uranus/backlog/` direto, se preferir.

**Vault.** O comando `uranus vault` (e a aba Vault no painel) mostra como tudo isso se conecta:
memórias podem referenciar outras memórias, backlog e instruções usando `[[wikilinks]]` no texto, e
o vault desenha esse grafo.

---

## Configuração

Tudo fica em `.uranus/config.yaml`. Por padrão, só duas coisas importam: o nome do projeto e as
opções do painel.

```yaml
version: 1

project:
  name: meu-projeto
  vcs:
    defaultBranch: main
```

Existe uma camada de configuração avançada (orçamento, validações de código, provedores de modelo,
integração automática) que ainda existe no código, para quando fizer sentido ativar. Ela não
aparece no assistente padrão porque hoje quem decide o fluxo é o Claude, via `uranus chat`, não um
processo automático rodando sozinho. Para ver ou mudar qualquer valor avançado, use
`uranus config set <caminho> <valor>` direto, ou edite o `config.yaml` à mão.

Você também pode sobrescrever qualquer valor por variável de ambiente (por exemplo,
`URANUS_PROJECT__NAME=outro-nome`), ou por uma configuração global em `~/.uranus/config.yaml`.

### Validações de código

O Uranus consegue rodar lint, testes e outras checagens sobre o que o Claude produz, mas por
padrão elas são só informativas: relatam problemas, não bloqueiam nada. Isso é proposital, porque
hoje é o Claude quem decide se um trabalho está pronto, com sua própria supervisão. Veja o que está
configurado com:

```bash
uranus validations
```

---

## Plugins

O Uranus não sabe nativamente o que é npm, Next.js ou Docker. Esse conhecimento vive em plugins,
que se ativam sozinhos quando o projeto é daquele tipo.

| Plugin | Ativa quando |
| --- | --- |
| `node` | existe `package.json` |
| `nextjs` | `next` está nas dependências, ou existe `next.config.*` |
| `docker` | existe `Dockerfile` ou `docker-compose.yml` |

```bash
uranus plugin list
```

```
Ativos:
  node         arquivo "package.json" existe
  nextjs       dependência "next" em package.json

Inativos:
  docker       nenhuma regra de detecção casou com este projeto
```

Para escrever um plugin próprio, crie uma pasta com um `uranus.plugin.json` e um módulo ES em
`.uranus/plugins/<id>/`, ou publique como um pacote npm com `uranus-plugin` no nome. O manifesto
declara as permissões que o plugin precisa (`fs`, `net`, `exec`), e o padrão é o mais restritivo
possível. Antes de instalar um plugin de terceiro, audite com:

```bash
uranus plugin check ./caminho/do/plugin
```

---

## Solução de problemas

**`uranus doctor` diz que o `claude` falhou**
O CLI da Claude precisa de login próprio: rode `claude /login`. Se ele não estiver no PATH, o
Uranus procura automaticamente em `~/.local/bin` e `%APPDATA%/npm`.

**O Claude não consegue dar push ou abrir Pull Request**
Confirme que o repositório tem um remote configurado (`git remote -v`) e que o `gh` está
autenticado (`gh auth status`). Sem isso, o trabalho continua seguro na branch local: use
`git log` e `git diff` para ver o que foi feito.

**O painel não abre**
Confirme que a porta 4319 está livre, ou suba com outra porta: `uranus dashboard --port 4321`.

**Uma memória ou instrução não está aparecendo pro Claude**
Rode `uranus claude` para regenerar o `CLAUDE.md` com o que existe agora em `.uranus/`.

---

## Desenvolvendo o Uranus

```bash
pnpm install
pnpm check
pnpm coverage
```

### Pacotes do monorepo

| Pacote | Responsabilidade |
| --- | --- |
| `@uranus/core` | Tipos, contratos e domínio compartilhados. |
| `@uranus/config` | Configuração em camadas, com validação de schema. |
| `@uranus/events` | Log de eventos persistente, usado pelo painel. |
| `@uranus/state` | Banco de dados e repositórios do estado do projeto. |
| `@uranus/context` | Resumo automático do projeto (stack, testes, CI). |
| `@uranus/memory` | Memória em Markdown, com atualização automática. |
| `@uranus/backlog` | Backlog e o vínculo entre projetos relacionados. |
| `@uranus/plugins` | Carregador de plugins, SDK e os plugins node, nextjs e docker. |
| `@uranus/providers` | Integração com o Claude Code e com outros modelos, como suporte avançado. |
| `@uranus/agents` | Catálogo de agentes e o motor que os executa. |
| `@uranus/dashboard` | Servidor do painel web: eventos em tempo real. |
| `@uranus/cli` | A interface de linha de comando, o `uranus` que você digita. |
| `@uranus/kernel` | O motor de execução automática antigo, hoje usado só como suporte avançado. |

### Documentação

* [Arquitetura](docs/00-ARCHITECTURE.md)
* [Roadmap](docs/02-ROADMAP.md)
* [Árvore do projeto](docs/03-TREE.md)

---

## Licença

Apache 2.0
