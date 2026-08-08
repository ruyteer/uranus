import { readFile } from 'node:fs/promises'

/**
 * Ingestão de backlog escrito em Markdown — o formato que humanos já usam.
 *
 * Reconhece listas de tarefas (`- [ ] título`) e seções (`## título` + corpo).
 * O objetivo não é interpretar semanticamente; é transformar um arquivo que
 * alguém já mantém em itens acionáveis sem exigir que ele mude de ferramenta.
 */

export interface ParsedBacklogItem {
  readonly title: string
  readonly body: string
  readonly labels: readonly string[]
  readonly externalRef: string
}

export function parseMarkdownBacklog(
  content: string,
  sourcePath: string,
): readonly ParsedBacklogItem[] {
  const items: ParsedBacklogItem[] = []
  const lines = content.split(/\r?\n/)

  let currentHeading: { title: string; body: string[] } | undefined
  let lineNumber = 0

  const flushHeading = (): void => {
    if (currentHeading === undefined) return
    const body = currentHeading.body.join('\n').trim()
    // Cabeçalho sem corpo é título de seção, não item de trabalho.
    if (body !== '') {
      items.push({
        title: currentHeading.title,
        body,
        labels: extractLabels(`${currentHeading.title} ${body}`),
        externalRef: `${sourcePath}#${currentHeading.title}`,
      })
    }
    currentHeading = undefined
  }

  for (const line of lines) {
    lineNumber++

    const checkbox = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/.exec(line)
    if (checkbox !== null) {
      // Item já concluído não vira trabalho.
      if (checkbox[1] !== ' ') continue
      const title = checkbox[2]!.trim()
      items.push({
        title: stripLabels(title),
        body: title,
        labels: extractLabels(title),
        externalRef: `${sourcePath}:${String(lineNumber)}`,
      })
      continue
    }

    const heading = /^(#{2,3})\s+(.+)$/.exec(line)
    if (heading !== null) {
      flushHeading()
      currentHeading = { title: stripLabels(heading[2]!.trim()), body: [] }
      continue
    }

    if (currentHeading !== undefined) currentHeading.body.push(line)
  }
  flushHeading()

  return items
}

export async function readMarkdownBacklog(path: string): Promise<readonly ParsedBacklogItem[]> {
  try {
    return parseMarkdownBacklog(await readFile(path, 'utf8'), path)
  } catch {
    return []
  }
}

/** `[bug]`, `[p1]`, `#backend` viram labels. */
function extractLabels(text: string): readonly string[] {
  const labels = new Set<string>()
  for (const match of text.matchAll(/\[([a-z0-9][a-z0-9-]{0,20})\]/gi)) {
    labels.add(match[1]!.toLowerCase())
  }
  for (const match of text.matchAll(/(?:^|\s)#([a-z][a-z0-9-]{1,20})/gi)) {
    labels.add(match[1]!.toLowerCase())
  }
  return [...labels]
}

function stripLabels(text: string): string {
  return text
    .replace(/\[[a-z0-9][a-z0-9-]{0,20}\]/gi, '')
    .replace(/(?:^|\s)#[a-z][a-z0-9-]{1,20}/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
