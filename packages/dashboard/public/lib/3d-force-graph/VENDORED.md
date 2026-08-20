# Vendorizado

- `3d-force-graph.mjs` — [3d-force-graph](https://github.com/vasturiano/3d-force-graph) 1.80.0, MIT.
  Motor 3D (Three.js + WebGL) por trás da navegação em "constelação" da aba Grafo.

Ao contrário do `force-graph` (2D) e do `agent-town`, este pacote publica um `dist/` de
verdade no npm — não precisou clonar/buildar do fonte. Mas o `dist/3d-force-graph.mjs`
publicado tem imports "nus" (`three`, `d3-force-3d`, `three-forcegraph`, ...), que não
funcionam como módulo ES direto no navegador (é como este painel serve tudo — ver
comentário no topo de `packages/dashboard/public/index.html`). Este arquivo é o mesmo
`dist/3d-force-graph.mjs` rebundlado com `esbuild --bundle --format=esm --minify` pra
ficar autocontido (zero `import` no arquivo final) — inclui o Three.js inteiro, por isso
o tamanho (~1.3 MB minificado; é o preço de WebGL 3D de verdade, não dá pra evitar).

Para atualizar: `npm install 3d-force-graph@<versão>` num diretório temporário, depois
`esbuild node_modules/3d-force-graph/dist/3d-force-graph.mjs --bundle --format=esm
--minify --outfile=3d-force-graph.mjs` e copiar o resultado pra cá.
