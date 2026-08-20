# Vendorizado

- `force-graph.mjs` — [force-graph](https://www.npmjs.com/package/force-graph) 1.51.4, MIT
  (o motor de canvas por trás do `react-force-graph`; aqui sem o wrapper React, que o
  painel não usa).

O pacote publicado só distribui um `.mjs` com imports "nus" (`d3-force-3d`, `lodash-es`,
...) — funciona com bundler, mas não como módulo ES direto no navegador, que é como este
painel serve tudo (ver comentário no topo de `packages/dashboard/public/index.html`). Este
arquivo é o mesmo `dist/force-graph.mjs` do pacote, rebundlado com `esbuild --bundle
--format=esm --minify` para ficar autocontido (zero `import` no arquivo final, um único
`export default`). Sem transformação de comportamento — é o mesmo código, só embrulhado.

Para atualizar a versão: `npm install force-graph@<versão>` num diretório temporário,
depois `esbuild node_modules/force-graph/dist/force-graph.mjs --bundle --format=esm
--minify --outfile=force-graph.mjs` e copiar o resultado para cá.
