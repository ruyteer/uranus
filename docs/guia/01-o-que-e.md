# 1. O que é o Uranus

← [Índice do guia](README.md) · Próximo: [Primeiros passos](02-primeiros-passos.md) →

## Em uma frase

**O Uranus é uma armadura para o Claude Code.** O Claude continua sendo quem programa; o Uranus é
o que ele veste para trabalhar gastando menos, errando menos, sem colocar seu projeto em risco, e
dando conta de projetos grandes.

## O problema que ele resolve

O [Claude Code](https://claude.com/claude-code) é um assistente que programa direto no seu
computador: você pede algo em português, ele lê o código, edita arquivos e roda comandos. Ele é
muito bom nisso. Mas, usado "puro", tem quatro limitações:

| Sem o Uranus                                             | Consequência                                                         |
| -------------------------------------------------------- | -------------------------------------------------------------------- |
| Cada sessão começa do zero                               | Você explica de novo a mesma convenção, a mesma decisão, o mesmo bug |
| Ele lê o projeto inteiro sozinho, com o modelo mais caro | Gasta muito para tarefas simples                                     |
| Não existe uma fila organizada de pedidos                | O trabalho fica espalhado em conversas soltas                        |
| Você não vê o que está acontecendo                       | Difícil confiar, difícil corrigir o rumo                             |

## A analogia da armadura

Pense num profissional muito talentoso que acabou de ser contratado. Ele sabe programar, mas não
conhece a sua empresa. Para render bem, ele precisa de:

- **um caderno de anotações** que não se perde entre um dia e outro → a **memória** do Uranus;
- **uma lista de tarefas** organizada → o **backlog**;
- **um manual da empresa**: como as coisas são feitas aqui, quem chamar para quê → o `CLAUDE.md` e
  os **agentes especialistas** que o Uranus gera;
- **um gerente que acompanha** e pode intervir → o **painel web**.

A armadura não luta no lugar de quem a veste. Ela protege, dá força e dá direção. É exatamente isso
que o Uranus faz com o Claude.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/uranus-armadura-dark.svg">
    <img alt="O Uranus é a armadura em volta do Claude Code: você manda pedidos para o backlog; o Claude lê os pedidos, lê e grava a memória, segue as regras do CLAUDE.md e dos 12 agentes, mostra o que faz no painel e entrega código revisado ao seu projeto — de forma econômica, eficiente, segura e escalável." src="../assets/uranus-armadura-light.svg" width="900">
  </picture>
</p>

## "Treinar" o Claude: o que isso significa aqui

O Uranus **não** retreina o modelo de IA. "Treinar", aqui, é dar ao Claude, toda vez que ele abre
o seu projeto, as instruções e a memória certas para que ele já comece sabendo:

1. **o que é o projeto** — linguagens, frameworks, como rodar os testes (o Uranus descobre sozinho);
2. **como trabalhar nele** — dividir tarefas grandes, delegar para especialistas, usar o modelo
   mais barato que dê conta, revisar antes de dar como pronto;
3. **o que já foi decidido** — tudo que ficou gravado na memória em sessões anteriores;
4. **o que você quer** — os itens do backlog e as suas instruções do projeto.

Quanto mais você usa, mais a memória cresce, e melhor o Claude trabalha naquele projeto. Os detalhes
estão em [Como o Uranus treina o Claude](03-como-treina-o-claude.md).

## Os quatro objetivos

Tudo no Uranus existe para fazer o Claude trabalhar de um jeito:

| Pilar            | Em linguagem simples                                             |
| ---------------- | ---------------------------------------------------------------- |
| 💰 **Econômico** | Gastar o mínimo de tokens (e dinheiro) para chegar no resultado  |
| ⚡ **Eficiente** | Não refazer trabalho, não reexplicar, paralelizar o que dá       |
| 🛡️ **Seguro**    | Não estragar o seu projeto, não vazar segredos, você no controle |
| 📈 **Escalável** | Funcionar igual em projeto pequeno e em monorepo gigante         |

Cada pilar tem mecanismos concretos por trás — veja [Os quatro pilares](04-os-quatro-pilares.md).

## O que o Uranus _não_ é

- **Não é outro modelo de IA.** Quem escreve o código é o Claude.
- **Não é um serviço na nuvem.** Tudo roda no seu computador; os dados ficam na pasta `.uranus/`
  do seu projeto, em arquivos que você consegue ler e editar.
- **Não substitui você.** Você decide o que entra no backlog, o que vira memória e o que vai para
  a branch principal.

---

← [Índice do guia](README.md) · Próximo: [Primeiros passos](02-primeiros-passos.md) →
