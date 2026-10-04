# 9. Problemas comuns

← [Configuração e plugins](08-configuracao-e-plugins.md) · Próximo: [Vídeo e motion](10-video-e-motion.md) →

Primeiro passo para qualquer problema: `uranus doctor`.

### `uranus: command not found`

O `npm link` não foi feito ou não está no PATH. Rode de novo dentro de `packages/cli` do repositório
do Uranus: `npm link`.

### `uranus doctor` diz que o `claude` falhou

O Claude Code precisa de login próprio: `claude /login`. Se ele não estiver no PATH, o Uranus
procura sozinho em `~/.local/bin` e `%APPDATA%/npm`.

### `uranus chat` diz para rodar `uranus init` primeiro

Você está numa pasta sem `.uranus/`. Entre na raiz do seu projeto ou rode `uranus init` ali.

### Uma memória ou instrução não está chegando ao Claude

Rode `uranus claude` para regenerar o `CLAUDE.md` com o que existe agora em `.uranus/`
(`uranus chat` já faz isso ao abrir).

### O Claude não consegue dar push ou abrir Pull Request

Confira se o repositório tem remote (`git remote -v`) e se o `gh` está autenticado
(`gh auth status`). Sem isso o trabalho continua seguro numa branch local: use `git log` e
`git diff` para ver o que foi feito.

### O painel não abre

A porta 4319 pode estar ocupada: `uranus dashboard --port 4321`.

### O painel não sobe com `host: 0.0.0.0`

É proposital: exposto em rede, o painel exige `telemetry.dashboard.token`. Veja
[O painel web](06-painel.md#segurança).

---

← [Configuração e plugins](08-configuracao-e-plugins.md) · Próximo: [Vídeo e motion](10-video-e-motion.md) →
