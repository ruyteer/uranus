# Vendorizado

- `xterm.mjs`, `xterm.css` — [@xterm/xterm](https://www.npmjs.com/package/@xterm/xterm) 6.0.0, MIT.
- `addon-fit.mjs` — [@xterm/addon-fit](https://www.npmjs.com/package/@xterm/addon-fit) 0.11.0, MIT.
- `addon-unicode11.mjs` — [@xterm/addon-unicode11](https://www.npmjs.com/package/@xterm/addon-unicode11)
  0.9.0, MIT. Corrige a largura de coluna de caracteres wide/box-drawing/braille — sem isso, telas
  cheias como a do Claude Code (Ink) desalinham a cada redesenho.

Copiado de `node_modules` (build ESM pronto, sem transformação) porque o painel não usa bundler
nem CDN — ver o comentário no topo de `packages/dashboard/public/index.html`. Para atualizar a
versão: `pnpm add @xterm/xterm@<versão> @xterm/addon-fit@<versão> @xterm/addon-unicode11@<versão>
--filter @uranus/dashboard` e recopiar os arquivos `lib/*.mjs` e `css/xterm.css` de dentro dos
pacotes instalados (tira a linha `//# sourceMappingURL=...` de cada um; os `.map` não são
vendorizados).
