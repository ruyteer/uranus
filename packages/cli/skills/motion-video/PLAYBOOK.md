# Motion Playbook — vídeo com o Claude Code

Conhecimento acumulado produzindo vídeos de verdade, aprovados (e reprovados) por quem encomendou.
Vale para **qualquer projeto**: o produto, a marca e os materiais mudam; o processo, as regras e as
pegadinhas técnicas são os mesmos.

Cobre dois tipos de trabalho:

- **Motion de produto** (SaaS, app, site): anúncio para Reels/TikTok/Shorts, vídeo de vendas para
  YouTube, tutorial com a tela real — §1 a §11;
- **Edição de vídeo gravado** ("talking head": a pessoa falando para a câmera + motion ilustrando a
  fala) — §12.

As Regras de ouro (§0) valem para os dois; onde o tipo muda a regra, está indicado.

> **Materiais do projeto primeiro.** Antes de desenhar qualquer cena, levante o que o projeto já
> tem: tokens de design (cores, raios, sombras), fontes, logo e símbolo, biblioteca de ícones,
> componentes, copy da landing, telas reais. O vídeo é feito **com** isso — nunca com uma estética
> inventada. Se o projeto já tiver uma pasta de vídeos aprovados, ela é a referência número um.

## 0. Regras de ouro (leia antes de qualquer coisa)

1. **Roteiro e storyboard aprovados antes** de gerar voz ou código. Mostre e espere o "ok".
2. **O protagonista é a pessoa ou o produto real**: celulares com o app, telas do painel, dados de
   demonstração. Nada de arte abstrata/metal líquido/aurora violeta como protagonista (reprovado, §10).
3. **Voz natural**: ElevenLabs Eleven v3 em **tomada única** (nunca frase a frase), depois
   compactar os silêncios (§1.1).
4. **Retenção**: gancho no 1º segundo, corte a cada 1–4 s, nunca tela vazia/parada, encerramento ≤ 1,2 s.
5. **Legendas**: no motion de produto, só **ênfase** centralizada (sans + serifada itálica com
   degradê); no talking head, **bloco inteiro de até 3 palavras com fade** (§12). **Nunca** piscar
   palavra por palavra (karaokê/pop por palavra "parece que travou") nem contorno estilo TikTok ("feio").
6. **Efeitos sonoros abaixo da voz, mas audíveis**, no quadro exato da animação, e **sempre medidos**
   (um bug já entregou SFX mudos). Motion de produto: volume 0,10–0,22; talking head: ~7 dB abaixo
   dos picos da voz (§12). **Sem música** (quem publica põe no app; evita direitos autorais).
7. **Interface 100% fiel**: tela real capturada ou reconstrução a partir de prints reais, com os
   tokens reais do projeto; textos exatos.
8. **Anúncio pago: 20–30 s** (9 s foi reprovado: "não serve pra rodar anúncio"). Tutorial: o
   necessário, com capítulos.
9. **Áudio final −14 LUFS, pico ≤ −1 dBTP** (mire TP −2/−3; o AAC sobe).
10. **Quadro 0 cheio** e QC olhando quadros do MP4 final (contact sheet) antes de entregar.
11. Chave de API **nunca no repositório**; arquivo de entrega > 30 MB não vai pelo chat (divida ou
    suba numa branch).

---

## 1. Gosto que já foi aprovado (ponto de partida)

Use como padrão até a pessoa dizer outra coisa. Pergunte se o projeto já tem preferências.

- **Narração natural acima de tudo.** ElevenLabs, modelo **Eleven v3**, **tomada única** (§4).
  Vozes PT-BR que já foram aprovadas: masculina **Gabriel** (`k3f7zOv6LF88v78QHCNh`, "Shorts &
  Reels"); feminina **Roberta** (`RGymW84CSmfVugnA5tvA`, "Smooth and Confident"). Para outro idioma
  ou outro tom, gere amostras da mesma fala e deixe a pessoa escolher de ouvido.
- **Nada de legenda corrida no topo.** Só **legendas de ênfase** em cenas próprias (tela só com
  texto no meio), alternando com cenas do produto: produto → texto → produto…
- **Legendas no estilo da landing do projeto.** O padrão aprovado: palavras comuns numa sans (ex.:
  Geist 500) + a palavra de ênfase numa **serifada itálica** (ex.: Fraunces 600) com **degradê
  branco → branco 62%** (como um `h1` com `bg-gradient-to-b from-white to-white/60 bg-clip-text`).
  Se a landing do projeto usa outras fontes, use as dela.
- **Blocos do catálogo HyperFrames que agradaram:** `caption-editorial-emphasis`,
  `caption-parallax-layers`, `ui-3d-reveal`, `app-showcase`.
- **Encerramento = splash do app** (símbolo no centro com feixe de luz → desliza e revela o nome),
  seguido de tagline letra a letra e pílula com a URL ("parecido com o da Netflix").
- Primeiro 16:9 (YouTube), depois **a mesma coisa recomposta** em 9:16 (TikTok/Reels) com o mesmo
  áudio. Quem encomenda quase sempre quer os dois.
- Efeitos sonoros e voz **todos da ElevenLabs** (qualidade maior que banco genérico). Música: não.

## 1.1 Retenção e ritmo ("muito lento, o público precisa estar sempre retido")

Obrigatório para vídeo curto (Reels/TikTok/Shorts) e para o 16:9 de anúncio:

- **Pausa entre falas ≤ 0,2 s.** A tomada única do Eleven v3 respeita a pontuação, mas respira
  demais para Reels. Depois de gerar a voz, faça _jump cut_ nos silêncios (≤ 0,06 s dentro da
  frase, ≤ 0,10 s na vírgula, ≤ 0,16 s entre frases/cenas) e acelere **1,06–1,08×** com `atempo`
  (mesmo timbre). Exemplo real: 37,2 s → 31,6 s, mesma voz, mesmas palavras.
- **Ritmo-alvo ≈ 2,6–3 palavras/s** e **um corte a cada 1–4 s**. Cena de texto de ênfase: 1–3 s.
  Nenhuma cena > 6 s.
- **Nunca tela vazia.** Todo corte já entra com algo em movimento (punch-in `scale 1.07→1` em
  0,32 s no próprio corte) e o elemento principal aparece **no quadro do corte**, não "quando a
  próxima palavra chegar". Revise snapshots **logo depois de cada corte** (t = corte + 0,2 s).
- **Gancho no 1º segundo** (pergunta direta ao público), segundo gancho até 3,5 s e a
  promessa/preço até ~5 s.
- **Encerramento curto:** no máximo 1,2 s depois da última palavra.
- Efeitos sonoros **bem abaixo da voz** (0,12–0,22).
- Tudo que dita o tempo sai de um único `plan.mjs` (marcas por palavra): encurtar a voz
  re-temporiza o vídeo inteiro sozinho; depois só confira cenas com animação de duração fixa.

## 2. Fluxo de trabalho (a ordem importa)

1. **Intake curto:** canal, proporção, duração, história, fonte visual, idioma, voz. Só pergunte o
   que muda o resultado. Levante os materiais do projeto (ver o aviso no topo).
2. **Roteiro** (≈ 150 palavras/min em PT-BR → 30 s ≈ 75 palavras). Mostrar e pedir aprovação
   **antes** de gerar voz. Estrutura que funcionou: _gancho de situação_ ("Três da manhã…") → prova
   → como funciona (3 passos) → benefício → prova no produto → slogan → CTA.
3. **Storyboard** com tabela tempo × cena × fala × âncora de transição; **lista de fatos** (todo
   número/claim com fonte). Números de exemplo precisam ser aprovados como "dados de demonstração".
4. **Referências reais:** subir o app local com dados de demonstração e tirar prints em 390×844
   (mobile) e 1280×800 (desktop). A UI do vídeo é **reconstrução fiel** em HTML/CSS com os tokens
   reais do projeto — nunca redesenhar.
5. **Voz → timestamps → plano de tempo** (§4). A voz manda no relógio; nada de tempo "no chute".
6. **Composição** HyperFrames (§3), `lint`, **snapshots nos tempos-chave**, olhar, corrigir.
7. **Render → mix (loudnorm) → QC** (§7) → entregar o MP4.
8. Versão para outra proporção: copiar o projeto, **mesmo áudio e plano**, recompor só
   layout/câmera (§6, §9).

Mantenha o projeto de vídeo numa pasta própria (ex.: `marketing/<nome-do-video>/`), fora do
workspace de build do app, com `renders/` no `.gitignore`.

## 3. HyperFrames (render determinístico HTML + GSAP)

- Projeto próprio fora do workspace (pnpm/yarn) do app: `package.json` com `hyperframes`
  **pinado** (testado: 0.8.81) + `gsap`. Fontes: **as do projeto** (via `@fontsource` ou os
  arquivos locais dele). Ícones: **a mesma biblioteca do app** (ex.: `lucide-static` se o app usa
  lucide).
- Sempre rodar com `DO_NOT_TRACK=1 HYPERFRAMES_NO_TELEMETRY=1`.
- Em ambiente com Chromium pré-instalado, aponte
  `PRODUCER_HEADLESS_SHELL_PATH=<caminho do headless_shell>` (senão ele tenta baixar o Chrome).
  ffmpeg é necessário.
- **GSAP e fontes LOCAIS.** O Chrome do render pode não passar por proxy: bloco do catálogo que
  puxa GSAP/fontes de CDN renderiza **parado**. Troque `cdn.jsdelivr...gsap.min.js` por
  `vendor/gsap.min.js` e fontes por `@font-face` local.
- Contrato: um root `data-composition-id="main"` com `data-duration`; **uma** timeline
  `gsap.timeline({paused:true})` registrada em `window.__timelines["main"]` **no fim** do build
  (pode ser dentro de `await document.fonts.load(...)`).
- `<audio id=… src data-start data-duration data-volume data-track-index>` estáticos no HTML
  (gerados no build). Áudios que se sobrepõem precisam de `data-track-index` diferentes.
- **Pegadinhas que custaram render:**
  - GSAP 3 **não** anima `className` nem `textContent` → use dois elementos e troque `opacity`/`display`.
  - `stroke-dasharray` + `pathLength="1"`: coloque como **atributo** no SVG e anime
    `attr: {"stroke-dashoffset": …}`; via CSS o traço aparece grosso e antes da hora.
  - Seletor CSS genérico em SVG (`#fc svg {…}`) pega também os **ícones** dentro dos nós → `#fc > svg`.
  - `left/top/width/height` animados dão "degraus" (lint `gsap_non_transform_motion`) → use
    `x/y/scale` ou `clip-path`.
  - Segundo `fromTo` no mesmo alvo → `immediateRender: false` (senão o "from" vira estado de repouso).
  - Meça o layout (offsets, alturas) **antes** de criar qualquer `fromTo` (eles aplicam o estado
    inicial na hora).
  - Posição de elemento que muda depois (lista que cresce): calcule a posição **no momento** da ação.
  - No `build.mjs`, substitua sempre com **função** (`.replace(x, () => texto)`): texto com `$$`
    vira `$` num replace com string.
- Build: `src/index.html` + `build.mjs` troca `{{i:icone}}` pelo SVG do ícone, `{{plan}}` pelos
  tempos e `{{audio}}` pelas tags.
- Validar: `npx hyperframes lint` → `npx hyperframes snapshot --at t1,t2,… --no-end --describe false -o renders/snaps`
  (gera contact sheet — olhar SEMPRE antes do render completo).
- Render: `npx hyperframes render -q high -f 30 -w 4 -o renders/master.mp4` (~1,5–2 min para 30 s).

## 4. Voz com ElevenLabs (o que funcionou e o que não)

- **Plano:** o gratuito não usa vozes da biblioteca pela API e não permite uso comercial → precisa
  de pago (Starter serve). Starter **não** libera `pcm_44100` nem `mp3_44100_192` → peça
  `mp3_44100_128` e converta com ffmpeg.
- **Rede:** o ambiente precisa liberar `api.elevenlabs.io`.
- **Chave:** guardar só fora do repositório (arquivo com permissão 600, fora do git); nunca
  commitar; recomendar rotação se foi colada no chat.
- Vozes de biblioteca: buscar com `GET /v1/shared-voices?language=pt&gender=male&use_cases=…`,
  adicionar com `POST /v1/voices/add/{public_owner_id}/{voice_id}`, gerar amostras da **mesma fala**
  para a pessoa escolher de ouvido.
- ❌ `eleven_multilingual_v2` numa tomada com `<break/>`: entonação ruim, não respeita vírgulas/pontos.
- ❌ Frase a frase + colagem com pausas: **picotado**, sem fluidez humana (reprovado).
- ❌ v2 numa tomada sem breaks: atropela (23 s para um texto de 32 s).
- ✅ **`eleven_v3`, tomada única**, `stability 0.5`, texto com pontuação natural e **parágrafos por
  cena** (`\n\n` entre cenas). Respeita pontos e reticências. É o padrão.
- `/with-timestamps` devolve alinhamento por **caractere** → juntar em palavras → mapear para as
  frases do `segments.json` (texto exibido × texto falado) → `words.json` com `seg`.
- Nomes de marca: escreva foneticamente no texto falado (ex.: "Órion Bot") e mantenha a grafia
  certa no texto exibido ("OrionBot").

## 5. Efeitos sonoros (ElevenLabs Sound Effects)

- `POST /v1/sound-generation` com `text`, `duration_seconds`, `prompt_influence 0.55`.
- Prompts curtos e específicos terminando em "short, dry, no music". Kit básico: `notif`,
  `chaching`, `tap`, `typing`, `whoosh`, `slam` (impacto de texto), `success`, `riser`, `logo`, `pop`.
- **Checar o volume** de cada efeito (`volumedetect`): alguns vêm quase mudos (pop −55 dB) →
  regenerar com "loud, clear, close-up".
- Colocar no **quadro da causa** (toque, impacto, palavra). Volumes **0,10–0,22** (`logo` 0,28);
  voz sempre por cima. Não deixe efeito da cena anterior vazar para a próxima (filtre por tempo de corte).

## 6. Linguagem visual e receitas de cena

**Tokens:** sempre os do projeto (fundo, cor de destaque, grão/textura da landing, fonte do app,
fonte dos títulos). Exemplo de um projeto real: fundo `#09090a` + halo azul
(`oklch(0.55 0.19 258)`), grão SVG fractal noise (opacity .05, overlay), Geist no painel, Fraunces
nos títulos.

| Cena                 | Receita                                                                                                                                                                                                                                                                                            | 16:9                 | 9:16                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------ |
| Gancho               | celular em CSS com `perspective`, `rotationY -24 → -8`, notificações empilhando **acelerando**                                                                                                                                                                                                     | celular centralizado | escala 1.3→1.45                                                          |
| Ênfase               | `caption-editorial-emphasis`: bloco por frase; palavras comuns entram com `scale 1.12→1` no tempo da palavra; linha de ênfase entra deslizando de `x -1920` em 0.22 s; bloco faz push `scale 1→1.035`                                                                                              | esquerda, 92/230 px  | 84 px de margem, fonte auto-encaixa em 912 px                            |
| Marca → produto      | símbolo com anel SVG sendo desenhado → encolhe → janela entra                                                                                                                                                                                                                                      |                      |                                                                          |
| Painel desktop       | `ui-3d-reveal`: card 1280×800 em `perspective 2800`, `preserve-3d`, face lateral de profundidade, glow; entra flat, **câmera aproxima no ponto de ação** (`scale`, `x=(640-cx)*s`, `y=(400-cy)*s`), inclina `rotationY -22`; sai com fly-away (`x -2200`, `z -7500`, `rotationY -65`, `power4.in`) | escala 1.2–1.45      | 1.95 no diálogo; laterais cortadas ok                                    |
| Interação            | cursor (desktop) ou toque com onda (mobile) — nunca os dois; digitação com `width` + `steps(n)`; botão `scale .95→1`; loader → check                                                                                                                                                               |                      |                                                                          |
| Sequência de estados | `app-showcase`: três celulares em leque                                                                                                                                                                                                                                                            | leque ±560 px, ±8°   | **carrossel**: o ativo desliza pro centro, cresce, os outros ficam a 55% |
| Benefício gigante    | `caption-parallax-layers`: palavra enorme **atrás** do celular (esticada `scaleY`), legenda serifada na frente                                                                                                                                                                                     | uma linha            | duas linhas empilhadas                                                   |
| Prova                | números rolam (sai com blur pra cima, entra de baixo), linha nova na tabela cresce de altura 0                                                                                                                                                                                                     |                      |                                                                          |
| Fechamento           | splash (símbolo `xPercent` + `clip-path inset(0 X% 0 0)` → 0), holofote diagonal, tagline letra a letra, pílula com contorno desenhado                                                                                                                                                             |                      | centralizado, fora do rodapé                                             |

**Regras de movimento:** corte seco **na palavra** (2 quadros antes); uma direção dominante nas
trocas; zoom-through (escala + blur) só para "entrar mais fundo"; nenhum crossfade entre telas sem
relação; nada parado > 3 s; texto sempre legível no celular.

**Áreas seguras 9:16 (TikTok/Reels):** evitar texto importante no topo (~150 px), no rodapé
(~350–430 px) e na coluna direita (~120 px). Conteúdo-chave entre y ≈ 250 e 1500.

## 7. Mix e QC

- Loudnorm **em duas passadas**: `I=-14, TP=-2, LRA=11` (o AAC estoura se mirar −1,5).
- Checar: resolução/fps/duração, −14 ±1 LUFS e pico ≤ −1 dBTP, contact sheet (legibilidade,
  cortes, nada cortado na área segura), fatos só da lista aprovada.
- Entrega: `libx264 -crf 18 -preset slow -pix_fmt yuv420p -movflags +faststart`, AAC 192k.
  `renders/` fora do git.

## 8. Adaptando a um projeto novo (checklist)

1. Procure no projeto um vídeo já aprovado para usar de base; se não houver, comece pela estrutura
   do §2 numa pasta `marketing/<nome>/`.
2. Levante tokens (cores, fontes, logo, símbolo), textos e telas do produto — a partir de **prints
   reais** e do código do próprio projeto.
3. Roteiro → aprovação → voz (v3, tomada única) → timestamps → `words.json`.
4. Ajustar `plan.mjs` (quais palavras disparam cada ação) — é o único lugar com tempos.
5. `node build.mjs` → lint → snapshots → render → mix → QC → entregar.
6. Ao terminar, registre na memória do projeto (`uranus memory add`) o que a pessoa aprovou e
   reprovou — vira o "gosto" do §1 para os próximos vídeos daquele projeto.

## 9. Produção em paralelo e dois formatos

- **Um projeto, dois formatos**: `node build.mjs` (9:16, `src/`) e `node build.mjs 16x9`
  (`src/16x9/`), mesmo `audio/` e `plan.mjs`.
- Cada cena é um arquivo `src/scenes/NN-nome.html` (blocos `@css`/`@html`/`@js`, contrato num
  `SCENES-CONTRACT.md`): subagentes montam cenas em paralelo, cada um numa **cópia privada** do
  projeto (`tar`/`rsync` sem `src/scenes`, com symlink de `node_modules`), testam com lint +
  snapshots e só então copiam o arquivo final. O orquestrador faz roteiro, voz, `plan.mjs`, base
  (textos de ênfase, marca), integra, revisa e renderiza.
- Um agente de pesquisa na internet antes do roteiro (dores, vocabulário do nicho, ganchos,
  concorrência, políticas de anúncio).
- **Textos de ênfase centralizados** — `justify-content: center` e ajuste de fonte à largura.
- Pegadinhas: classes genéricas da base vazam para dentro das cenas — prefixe tudo com o id da
  cena; confira se a fonte tem todos os glifos (ex.: Geist não tem "ª"; use sobrescrito).
- Nicho sensível: o vídeo é **não explícito** (só interface, textos, arte abstrata); anúncio pago
  em Meta/TikTok/Google exige variação sem os termos do nicho.

## 10. Visual reprovado: "metal líquido"

- Roteiros escritos para geradores de vídeo por IA (Veo/Flow etc.) pediam objetos de **metal
  líquido cromado**, aurora azul/violeta e dourado. Traduzido em motion (esfera estourando, cofre,
  anel, monólito, moeda de mercúrio), o visual inteiro foi **reprovado**, mesmo com roteiro e voz
  aprovados.
- Regra: **o protagonista é sempre o próprio produto** — celulares com o app, tela de bloqueio com
  notificações, janelas do painel em 3D, carrossel de celulares, palavra gigante atrás do celular,
  cenas só de texto no estilo da landing, splash no fim. Fundo e cores: os da marca.
- Componentes novos do catálogo são bem-vindos **quando servem à UI** (notificações, toque, check,
  contagem, gráfico, troca de estado, zoom na tela), não como cenografia.
- Quando o roteiro vier com prompts de IA de vídeo, use só a copy/estrutura e ignore a direção de arte.
- **Quadro 0 vazio:** `tl.set` de duração zero em t=0 é desfeito quando o player volta a 0; deixe a
  cena que começa em 0 visível por CSS e só apague no corte.

## 11. Tutorial com a tela REAL do produto

- Tutorial ≠ comercial: gravação da plataforma de verdade + motion por cima.
- Ambiente local com banco e **dados de demonstração realistas** (seed). Se o login tem captcha
  que não carrega em navegador headless, crie a sessão direto (token/cookie de dev). Serviços
  externos que o painel chama: um mock local que responde e grava no banco local.
- Captura: Playwright, viewport 1440×810 com `deviceScaleFactor 2` (zoom nítido), screenshot a cada
  estado (hover/click/digitação a cada 3–5 caracteres/arraste) + `steps.json` com o retângulo do
  alvo, rótulo exato e a frase (`seg`) da narração. O motor posiciona câmera/cursor/rótulo pelos
  retângulos e ancora cliques na palavra falada.
- Arraste HTML5 não aparece no screenshot: recorte o "fantasma" do próprio screenshot.
- Só o que não é do produto (app de terceiros) é recriado.
- `requestAnimationFrame` não roda com a aba oculta: use `setTimeout` nos scripts de captura.

## 12. Edição de vídeo gravado — "talking head" com motion

Pessoa falando para a câmera (vídeo do celular) + motion ilustrando a fala. Formato 9:16,
1080×1920, 30 fps, ≤ 60 s.

### 12.1 Gosto: aprovado × reprovado

**Aprovado**

| Item                                | Detalhe                                                                                                                               | Por quê                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Visual "Apple minimalista"          | Fundo `#f5f5f7` (ou preto puro), sans + serifada itálica 600 com degradê na ênfase, muito respiro, 1 cor de destaque (ex.: `#0071e3`) | Limpo, premium, legível no celular         |
| Objetos 3D limpos ilustrando a fala | Moeda, cubo `{ }`, banco de dados, travesseiro… (Three.js; alumínio/cerâmica/vidro, luz suave)                                        | "Elementos 3D aparecendo enquanto eu falo" |
| Alternância de cenas                | Pessoa falando → só animação → só texto                                                                                               | Retenção; nada parado                      |
| Texto atrás da pessoa               | Palavra gigante serifada, cabelo passando na frente                                                                                   | Efeito premium                             |
| Tela dividida                       | Vídeo encolhe num card arredondado; objeto/título em cima                                                                             | Espaço pra ilustração sem tirar a pessoa   |
| Cards numerados                     | "01, 02…", ✓ em vidro fosco                                                                                                           | Lista clara                                |
| Antes × depois                      | "sem edição × com edição", correção de cor, B-roll na fala                                                                            | Formato de anúncio                         |
| Encerramento curto                  | Frase-tese + pílula do @ com contorno desenhado                                                                                       | ≤ 1,2 s após a última palavra              |
| SFX ElevenLabs                      | No quadro exato de cada animação, audíveis, abaixo da voz                                                                             | "Casar som com elemento visual"            |

**Reprovado**: legenda piscando palavra por palavra (pop/blur/karaokê — "parece que travou"); SFX
inaudíveis; legenda com contorno TikTok; metal líquido/aurora violeta/dourado/arte abstrata como
protagonista; ritmo lento e pausas longas; música no arquivo.

### 12.2 Fluxo (do pedido à entrega)

1. Copiar o vídeo para uma pasta de projeto separada.
2. Diagnóstico: `ffprobe` (resolução, fps, duração, **rotação**), folha de quadros (1 a cada 2 s),
   `volumedetect`, posição do rosto (grade sobre um quadro: topo da cabeça, olhos, queixo, espaço
   livre acima).
3. Transcrição por palavra (faster-whisper).
4. Achar erros cruzando transcrição + VAD + retranscrição dos trechos suspeitos: começos falsos,
   frases repetidas (fica a **última tentativa limpa**), frases abandonadas, falas de bastidor
   ("vamos lá", "obrigado"); palavra mal transcrita se corrige só no texto exibido.
5. Roteiro de corte com faixas explícitas de **manter**; cortar redundância até caber em ≤ 60 s.
6. Corte limpo no ffmpeg: trims + concat, aceleração leve, recorte 9:16, upscale, keyframes densos,
   tratamento de áudio.
7. **Retranscrever o corte** (confere que nenhuma palavra sumiu e dá os tempos definitivos).
8. Plano de cenas sobre os tempos novos (palavra que dispara cada ação; onde entram tela dividida,
   texto, 3D, cards).
9. Recorte da pessoa (remove-background) só se houver texto atrás e espaço acima da cabeça.
10. Composição HyperFrames (HTML + GSAP + Three.js) → lint → snapshots → corrigir.
11. Render → mix dos SFX → loudnorm 2 passadas → QC (folha 1 quadro/s, LUFS, pico, duração).
12. Entrega: MP4, com o @ do perfil no encerramento.

### 12.3 Ferramentas e parâmetros

**Transcrição e fala**

- faster-whisper `large-v3-turbo`, CPU `int8`, `language="pt"`, `word_timestamps=True`, `beam_size=5`.
- Trecho duvidoso: retranscrever isolado (beam 8), às vezes com +8 dB.
- VAD do faster-whisper (`get_speech_timestamps`, `min_silence_duration_ms=180`,
  `speech_pad_ms=60`) quando o ruído de fundo inutiliza o `silencedetect` (que só serve com áudio
  limpo: −32 a −35 dB, d ≥ 0,15–0,2 s).

**Cortes e ritmo**

- Margem 0,06–0,08 s em cada borda; micro-fade 12–15 ms no áudio de cada trecho.
- Pausas ≤ 0,2 s; aceleração 1,06–1,08× (`setpts` + `atempo`, mesmo timbre).
- Corte ou zoom a cada 1–4 s; nada parado > 3 s; cena de texto 1,5–3 s.
- Punch-in em cada troca de frase: `S×1,07 → S` em 0,32 s (`power2.out`), alternando plano aberto
  (1,0) e close (1,12–1,25) ancorado no rosto; para mostrar as mãos: escala 1,3 com deslocamento em y.
- Gancho no 1º segundo; o primeiro quadro já tem legenda.

**Vídeo (ffmpeg, pré-composição)**

- `scale=1080:1920:flags=lanczos`, `unsharp=5:5:0.5`, `eq` leve (contraste 1,04–1,05, saturação
  0,96–1,02), `fps=30`.
- `-c:v libx264 -crf 16 -preset slow -g 30 -keyint_min 30 -pix_fmt yuv420p` (keyframes densos
  evitam quadro congelado no render).
- Em versões recentes do ffmpeg: `-/filter_complex arquivo.txt` (o `-filter_complex_script` saiu) e `-fps_mode vfr`
  (o `-vsync` saiu).
- `drawtext` no Windows: copie a fonte para a pasta de trabalho (`fontfile=arial.ttf`).

**Áudio da voz**: `highpass=f=80–90` → `afftdn` moderado (`nr` 12–14, `tn=1`; forte demais deixa
robótico) → `volume` +10–12 dB se a voz estiver baixa → `acompressor` (−22 dB, 3:1) → `alimiter`
→ loudnorm 2 passadas `I=-14:TP=-2:LRA=11`, `linear=true`, 48 kHz, AAC 192k, `+faststart`.

**Legendas (versão aprovada)**

- Blocos de até 3 palavras; quebra em pontuação ou pausa > 0,35 s.
- O **bloco inteiro aparece de uma vez**: fade + subida (y 14 → 0) em 0,2 s, ~0,04 s antes da 1ª
  palavra; sai com fade de 0,1 s; emenda com o próximo se o intervalo for < 0,6 s. Nada de animação
  por palavra.
- Branco, sans 600 ~66 px com sombra suave; palavra-chave em serifada itálica ~80 px com degradê,
  estática.
- Sobre área escura e estável (peito ou cabelo), na área segura (y ≈ 1380–1500). Fundo claro atrás:
  pílula de vidro fosco com texto escuro. Esconder durante cena de texto, tela dividida e card grande.

**Composição (HyperFrames)**

- Mesmo contrato do §3 (versão pinada, telemetria desligada, GSAP/fontes locais,
  `.replace(x, () => texto)` no build). Three.js local via importmap (`three` → `vendor/three.module.js`).
- `<video muted>` + `<audio>` com a mesma fonte.
- Camadas: vídeo → texto atrás → vídeo do recorte (mesmas transformações) → placa de fundo →
  canvas 3D → interface → legendas.
- Tela dividida: `.cam` com `scale .5`, `y +420`, `clip-path inset(round 72px)` + sombra separada.
- Three.js: renderizar só no evento `hf-seek` (determinístico); RoomEnvironment + PMREM; px→mundo
  com câmera fov 30, z 16.
- Render `-q high -f 30 -w 4` (~3–4,5 min para 40–60 s com GPU).
- Recorte: `hyperframes remove-background … --quality best` → `.webm` com alpha (~12–18 min na CPU
  para 40–60 s); rodar em segundo plano e só se for usar.

**SFX (ElevenLabs)**

- Mesmo endpoint/prompts do §5. Kit: whoosh, swish, pop, tick, thud, chime, plunger, beep, error,
  shimmer, click.
- Normalizar cada SFX pelo pico (−3 dB) e **conferir que não ficou mudo**.
- Mixar depois do render: `adelay` + `amix normalize=0`, ganho base 0,12–0,30 × 2,8 (≈ 7 dB abaixo
  dos picos da voz); depois loudnorm do conjunto.
- Mapa: tela dividida/troca de cena → whoosh; card/texto deslizando → swish; item aparecendo →
  pop/tick; título forte → thud; solução/✓ → chime; riscado/"errado" → error; encerramento →
  shimmer + click.

### 12.4 Receitas de cena que funcionaram

- **Número que se transforma**: "R$ 29,90 → 2990 _centavos_" (dígitos com posição fixa; símbolo e
  vírgula saem, dígitos deslizam).
- **Precisão**: "29.900000" com as casas em destaque, chave desenhada embaixo, "6 dígitos de _precisão_".
- **Pipeline sobre o vídeo desfocado**: passos em vidro fosco entrando na palavra, ligados por uma linha.
- **Lista numerada** ("causa 01…04" → "solução ✓"); **riscado** ("ruga ~~dinâmica~~ vira
  _estática_"); **recapitulação** em chips no fecho; **diagrama sobre a pessoa**; **notificação
  estilo iOS**; **cena de pergunta** em placa clara separando causas de soluções.

### 12.5 Problemas e soluções

| Problema                               | Solução                                                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| SFX inaudíveis no vídeo entregue       | Um `afade=t=out:st=0:d=0.001` na normalização zerava os WAVs. Conferir com `volumedetect` num trecho sem voz e comparar picos com e sem SFX |
| Legenda "piscando"                     | Bloco inteiro com fade                                                                                                                      |
| Ruído quase no nível da voz            | VAD do Whisper em vez de `silencedetect`; `afftdn` moderado; recomendar gravar sem ventilador ou com lapela                                 |
| Whisper juntou duas tentativas         | Retranscrever o trecho isolado                                                                                                              |
| Script de cortes descartou uma frase   | Sempre retranscrever o corte e comparar com o roteiro                                                                                       |
| Texto atrás da pessoa sem sobreposição | Baixar até o cabelo cobrir a parte de baixo; sem espaço acima da cabeça, não usar                                                           |
| Moeda 3D com "R$" girado 90°           | `texture.center(.5,.5)` + `rotation = π/2`                                                                                                  |
| Objeto branco em fundo branco          | Formato reconhecível, cor levemente azulada, vinco encostado na superfície                                                                  |
| Palavra grande quebrando linha         | `white-space: nowrap`, fonte menor, mais espaço vertical                                                                                    |
| Quadro vazio após corte                | Elemento principal entra no próprio corte                                                                                                   |
| Legenda branca ilegível em fundo claro | Pílula de vidro com texto escuro, ou área escura                                                                                            |
| Estudar uma referência do Instagram    | `<video>` desenhado em `<canvas>` com `seek` (folha de quadros), sem baixar                                                                 |

### 12.6 Regras para talking head

1. 9:16, 1080×1920, 30 fps, ≤ 60 s.
2. Cortar erros, retomadas e bastidores sem dó; sempre a última tentativa limpa.
3. Pausas ≤ 0,2 s, 1,06–1,08×, corte/zoom a cada 1–4 s, nada parado > 3 s, nunca tela vazia.
4. Elementos visuais ilustram o que é dito, **na palavra exata**.
5. Estética limpa: fundo claro ou preto, sans + serifada itálica, 1 cor de destaque, vidro fosco,
   3D limpo — ou a identidade visual da pessoa, se ela tiver uma.
6. Legenda em bloco com fade, legível em qualquer fundo.
7. SFX em toda animação relevante, audíveis e abaixo da voz, verificados por medição.
8. Voz −14 LUFS, pico ≤ −1,5 dBTP (mire TP −2); levantar voz baixa, limpar ruído com moderação.
9. Lint + snapshots (incluindo logo após cada corte) antes do render; folha de QC 1 quadro/s depois.
10. Encerrar com frase-tese + @ do perfil, ≤ 1,2 s após a última palavra.
11. Próximos formatos previstos: **vários ângulos** (sincronizar pelo áudio, alternar nas frases,
    igualar a cor), **B-roll do usuário** (cheio, em card ou atrás do recorte), **antes × depois**
    com correção de cor.
