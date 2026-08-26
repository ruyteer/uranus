/**
 * Formata a nota de imagens anexadas a um item de backlog — texto puro, para
 * quem lê o item entender que precisa abrir os arquivos.
 *
 * Não há upload: o campo `images` de `BacklogItem` guarda só o caminho no
 * disco. Isto é o que transforma esse caminho cru numa instrução acionável —
 * usado tanto na saída de `uranus backlog show` (que uma sessão de
 * `uranus chat` lê e age) quanto no prompt que o `Planner` recebe.
 */
export function formatImagesNote(images: readonly string[]): readonly string[] {
  if (images.length === 0) return []
  return [
    'Imagens anexadas (abra cada uma com a ferramenta de leitura e analise o que foi pedido nela):',
    ...images.map((path) => `  - ${path}`),
  ]
}
