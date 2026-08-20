# Vendorizado

- `agent-town.mjs` — [agent-town](https://github.com/rafapetter/agent-town) 0.2.0, MIT. Biblioteca de
  visualização em pixel art de agentes de IA trabalhando (a bolinha da aba Sala).

**O pacote publicado no npm (`agent-town@0.2.0`) está quebrado** — o tarball só tem
`LICENSE`/`README.md`/`package.json` e um `dist/tsconfig.tsbuildinfo` perdido; os arquivos de build de
verdade (`dist/agent-town.js`, `dist/agent-town.umd.cjs`) que o `package.json` aponta nunca foram
publicados (`npm pack agent-town --dry-run` confirma). `import { AgentTown } from 'agent-town'` falha pra
qualquer um que instale hoje.

Por isso este arquivo não veio de `node_modules` como o `force-graph`/`xterm` — veio de clonar o
repositório (commit `78e8e91`, 2026-03-09) e rodar `npm install && npx vite build` ali dentro
(`vite.config.ts` do próprio projeto já gera ESM + UMD a partir de `src/index.ts`). O build é
zero-dependência de verdade (`grep -c '^import ' dist/agent-town.js` dá 0) — só copiei
`dist/agent-town.js` pra cá, sem transformação.

Para atualizar: clonar `github.com/rafapetter/agent-town`, `npm install`, `npx vite build`, checar se
`npm pack agent-town@<versão> --dry-run` já inclui os arquivos de `dist/` de verdade (se sim, o pacote foi
consertado e dá pra voltar a instalar via npm normalmente em vez de buildar do fonte) e copiar
`dist/agent-town.js` de novo.
