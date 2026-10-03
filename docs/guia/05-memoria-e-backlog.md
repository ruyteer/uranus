# 5. Memória, backlog e vault

← [Os quatro pilares](04-os-quatro-pilares.md) · Próximo: [O painel web](06-painel.md) →

Essas são as peças que fazem o Claude "lembrar" do seu projeto entre uma sessão e outra.

## Backlog — a fila de pedidos

O backlog é a lista do que você quer que seja feito, em texto livre.

```bash
uranus backlog add "Login com Google" --body "Hoje só tem e-mail e senha." --priority 80
uranus backlog list            # tudo, com progresso
uranus backlog show <id>       # um item completo, com plano e subtasks
uranus backlog status <id> done
```

Estados de um item: `open` (aberto) → `planned` (já quebrado em subtasks) → `done` (feito), ou
`dropped` (descartado). O próprio Claude muda o estado quando termina ou quando você decide
abandonar um item na conversa.

Os itens ficam em `.uranus/backlog/*.yaml`, um arquivo por item — dá para editar à mão. Já tem uma
lista em Markdown? Use `uranus backlog import lista.md`.

## Memória — o caderno de anotações

A memória guarda o que vale a pena lembrar no futuro: uma decisão e o porquê, uma preferência sua,
um bug recorrente e a causa raiz, uma convenção que não está óbvia no código.

O Claude grava sozinho durante o `uranus chat` (o `CLAUDE.md` ensina quando e como). Você também
pode gravar:

```bash
uranus memory add "Datas sempre em UTC" --scope convention \
  --body "O banco guarda UTC; só o front converte para o fuso do usuário."
uranus memory list
```

**Escopos** organizam a memória por tipo: `architecture`, `decision`, `bug`, `preference`, `stack`,
`pattern`, `convention`, `roadmap`, `history`, `context`.

A memória fica em `.uranus/memory/<escopo>/*.md`, em Markdown legível. Se você corrigir uma nota à
mão, o Uranus detecta a edição e respeita a sua versão. Quando um escopo fica grande demais,
`uranus memory compact` revalida e resume.

## Vault — tudo ligado

Memória, itens de backlog e instruções podem citar uns aos outros com `[[título da nota]]` no
texto, como numa wiki. O resultado é um grafo de conhecimento do projeto:

```bash
uranus vault
```

Mostra as ligações e, no fim, os links que ainda apontam para uma nota inexistente. No painel, a
aba **Vault** desenha esse grafo em 3D.

> O texto dentro de `[[...]]` precisa ser o **título exato** de uma nota que já existe.

## Instruções — as regras da casa

Instruções são regras fixas que você quer que o Claude siga sempre ("use pnpm, nunca npm", "textos
da interface em português"). Cadastre pela aba **Instruções** do painel ou em
`.uranus/instructions/`. Elas entram no `CLAUDE.md`; com escopo de pasta, só valem ali.

**Memória ou instrução?** Instrução é uma regra que você impõe. Memória é algo aprendido no
caminho. Na dúvida: se você diria "sempre faça assim", é instrução.

---

← [Os quatro pilares](04-os-quatro-pilares.md) · Próximo: [O painel web](06-painel.md) →
