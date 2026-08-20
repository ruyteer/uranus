# Fontes do dashboard

`poppins-300/400/500/600.woff2` — subconjunto **latin** da Poppins, servidos
pelo próprio dashboard.

## Por que estão versionados aqui

O painel roda com CSP `default-src 'none'` e não fala com host externo. Um
`<link>` para o Google Fonts é bloqueado, e `src: local('Poppins')` só
funciona se o usuário já tiver a fonte instalada no sistema — o que não é o
caso na máquina de referência deste projeto. Servir os arquivos é a única
forma de a Poppins realmente aparecer sem abrir a CSP para fora.

São 31 KB no total (subconjunto latin, quatro pesos). Os pesos 200 e 700 não
foram incluídos por não serem usados pela folha de estilo.

## Licença

Poppins é distribuída sob a **SIL Open Font License 1.1**, que permite
redistribuição e hospedagem própria, inclusive embutida em software.
Autores: Indian Type Foundry, Jonny Pinhorn.
Texto da licença: <https://openfontlicense.org/>
Origem dos arquivos: `fonts.gstatic.com` (Google Fonts, família Poppins v24).

## Como declarar no CSS

```css
@font-face {
  font-family: 'Poppins';
  font-style: normal;
  font-weight: 300;              /* repetir para 400, 500 e 600 */
  font-display: swap;
  src: url('./fonts/poppins-300.woff2') format('woff2');
}
```

O servidor precisa de `font-src 'self'` na CSP — `default-src 'none'` cobre
`font-src`, então sem essa linha o navegador recusa os arquivos mesmo estando
na mesma origem.

## Trocar ou acrescentar peso

Solte o `.woff2` aqui e acrescente o `@font-face` correspondente. Nada mais
precisa mudar: o servidor já serve `.woff2` deste diretório.
