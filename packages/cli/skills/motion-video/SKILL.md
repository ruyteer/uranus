---
name: uranus-motion-video
description: Produz e edita vídeo direto no projeto — anúncio e vídeo de vendas para Reels, TikTok, Shorts e YouTube, motion de produto para SaaS/app/site, tutorial com a tela real, e edição de vídeo gravado (pessoa falando para a câmera) com motion, legendas, efeitos sonoros e narração por IA. Use sempre que o pedido envolver vídeo, motion, Reels, TikTok, Shorts, YouTube, anúncio em vídeo, edição de vídeo, legenda de vídeo ou narração.
---

# Vídeo e motion — playbook do Uranus

Você vai produzir vídeo usando **os materiais deste projeto**: os tokens de design, as fontes, o
logo, os ícones, os componentes e as telas reais do app — não uma estética inventada. O
conhecimento completo, com tudo o que já foi aprovado e reprovado em produções reais, está em
[`PLAYBOOK.md`](PLAYBOOK.md), nesta mesma pasta. Leia a seção que corresponde ao trabalho antes de
começar.

## Qual seção ler

| Pedido                                                 | Leia                         |
| ------------------------------------------------------ | ---------------------------- |
| Anúncio / vídeo de vendas / Reels de produto           | §0, §1, §1.1, §2, §3, §6, §7 |
| Mesmo vídeo em 16:9 e 9:16, ou produção com subagentes | §9                           |
| Tutorial mostrando a plataforma                        | §11 (+ §3, §7)               |
| Editar um vídeo gravado (pessoa falando)               | §0 e §12 inteiro             |
| Narração por IA, efeitos sonoros                       | §4, §5                       |
| Algo deu errado no render                              | §3 (pegadinhas), §12.5       |

## O processo em uma tela

1. **Intake curto**: canal, proporção, duração, história, idioma, voz. Só pergunte o que muda o resultado.
2. **Levante os materiais do projeto**: tokens (CSS/Tailwind/tema), fontes, logo e símbolo,
   biblioteca de ícones, copy da landing, prints reais (390×844 e 1280×800) com dados de
   demonstração. Procure vídeos já aprovados no repositório e na memória (`.uranus/memory/`).
3. **Roteiro → aprovação. Storyboard + lista de fatos → aprovação.** Nada de voz ou código antes do "ok".
4. **Voz** (ElevenLabs Eleven v3, tomada única) → compactar silêncios → timestamps por palavra →
   `plan.mjs` (o único lugar com tempos).
5. **Composição** em HyperFrames (HTML + GSAP, versão pinada, GSAP e fontes locais) → `lint` →
   snapshots nos tempos-chave e logo após cada corte → corrigir.
6. **Render → mix (loudnorm duas passadas, −14 LUFS) → QC** com contact sheet do MP4 final → entregar.
7. **Registre o gosto**: grave na memória o que a pessoa aprovou e reprovou
   (`uranus memory add "..." --scope preference`). O próximo vídeo deste projeto começa daí.

## Regras que nunca mudam

- O protagonista é **o produto real ou a pessoa** — nunca arte abstrata, metal líquido, aurora violeta.
- Interface **fiel**: reconstrução a partir de prints reais, com os tokens reais; textos exatos.
- Retenção: gancho no 1º segundo, corte a cada 1–4 s, pausas ≤ 0,2 s, nunca tela vazia,
  encerramento ≤ 1,2 s após a última palavra.
- Legenda: ênfase em cena própria (produto) ou bloco de até 3 palavras com fade (talking head).
  **Nunca** palavra por palavra piscando, **nunca** contorno estilo TikTok.
- Efeitos sonoros audíveis, abaixo da voz, no quadro exato — **medidos** com `volumedetect`. Sem música.
- Anúncio pago: 20–30 s. Áudio final −14 LUFS, pico ≤ −1 dBTP.
- Chave de API **nunca** no repositório. `renders/` fora do git.

## Paralelizar

Num vídeo com muitas cenas, cada cena vira um arquivo (`src/scenes/NN-nome.html`) e um subagente
monta cada uma numa cópia privada do projeto, testando com lint + snapshots (§9). Você, como
orquestrador, fica com roteiro, voz, `plan.mjs`, integração, revisão e render.
