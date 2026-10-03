# 8. Configuração e plugins

← [Referência de comandos](07-comandos.md) · Próximo: [Problemas comuns](09-problemas-comuns.md) →

## Configuração

Tudo fica em `.uranus/config.yaml`. No começo, só importa o nome do projeto:

```yaml
version: 1

project:
  name: meu-projeto
  vcs:
    defaultBranch: main
```

Três jeitos de mudar um valor, do mais simples ao mais direto:

1. `uranus config` — assistente com perguntas (ou a aba **Configuração** do painel);
2. `uranus config set <caminho> <valor>`;
3. editar o `config.yaml` à mão.

Valores também podem vir de uma configuração global em `~/.uranus/config.yaml` ou de variáveis de
ambiente (`URANUS_PROJECT__NAME=outro-nome`). `uranus config show` mostra de onde veio cada um.

### Configuração avançada

Orçamento, validações de código, outros provedores de modelo e o modo automático existem no código,
mas não aparecem no assistente padrão — no uso normal, quem conduz o trabalho é o Claude via
`uranus chat`. Para mexer nelas, use `uranus config set` ou edite o YAML. O formato completo está
em [Contratos](../01-CONTRACTS.md) e na seção de configuração da [arquitetura](../00-ARCHITECTURE.md).

### Validações de código

O Uranus consegue rodar lint, testes e outras checagens sobre o que o Claude produz. Por padrão
elas são **informativas**: relatam problemas, não bloqueiam. Veja o que está ativo com
`uranus validations`.

## Plugins

O núcleo do Uranus não sabe o que é npm, Next.js ou Docker — de propósito. Esse conhecimento mora
em plugins, que ativam sozinhos quando o projeto é daquele tipo:

| Plugin   | Ativa quando                                            |
| -------- | ------------------------------------------------------- |
| `node`   | existe `package.json`                                   |
| `nextjs` | `next` está nas dependências, ou existe `next.config.*` |
| `docker` | existe `Dockerfile` ou `docker-compose.yml`             |

```
$ uranus plugin list
Ativos:
  node         arquivo "package.json" existe
  nextjs       dependência "next" em package.json

Inativos:
  docker       nenhuma regra de detecção casou com este projeto
```

### Escrevendo um plugin

Crie uma pasta em `.uranus/plugins/<id>/` com um `uranus.plugin.json` (o manifesto) e um módulo
ES — ou publique no npm com `uranus-plugin` no nome. O manifesto declara as permissões que o plugin
precisa (`fs`, `net`, `exec`); o padrão é negar tudo. Antes de instalar um plugin de terceiros:

```bash
uranus plugin check ./caminho/do/plugin
```

---

← [Referência de comandos](07-comandos.md) · Próximo: [Problemas comuns](09-problemas-comuns.md) →
