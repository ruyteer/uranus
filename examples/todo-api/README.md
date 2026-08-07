# todo-api — exemplo do Uranus

Repositório mínimo para ver o Uranus trabalhar de ponta a ponta com o Claude Code.

## Uso

```bash
# 1. Transforme este diretório em um repo git independente
cd examples/todo-api
git init -b main && git add -A && git commit -m "estado inicial"

# 2. Inicialize o Uranus e verifique o ambiente
uranus init --name todo-api
uranus doctor

# 3. Enfileire a task de exemplo e rode
uranus task add --file tasks/add-remove-endpoint.yaml
uranus start

# 4. Acompanhe
uranus status
uranus logs --tail 100
```

O Uranus vai: criar um worktree isolado em `.uranus/w/`, invocar o Claude Code
com a especificação, rodar `node --test` para **provar** que funcionou, comitar
na branch `uranus/...` e (com remote + `gh` configurados) abrir um PR draft.

Se você matar o processo no meio (`Ctrl+C` ou `kill`), retome com:

```bash
uranus start --resume <runId>
```
