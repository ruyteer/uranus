import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Result } from '@uranus/core'
import { ValidationError, err, ok } from '@uranus/core'
import type { FileBacklogStore } from './store.js'

/**
 * Escrita no backlog de um projeto VIZINHO (categoria ④).
 *
 * Este módulo é o miolo determinístico da operação: como nomear o item de
 * forma idempotente, o que o corpo precisa dizer, e onde o arquivo pode
 * aterrissar. A fiação (ler a config, abrir a store do vizinho) é da
 * composição — aqui não se decide *se* pode escrever, só *como* se escreve
 * quando já se decidiu que pode.
 */

export interface CrossProjectItemInput {
  /** Nome do projeto que está PEDINDO (este). Vai no corpo e no `externalRef`. */
  readonly originProjectName: string
  /** Item de backlog daqui que originou o pedido. */
  readonly originItemId: string
  readonly title: string
  readonly intent: string
  readonly kind?: string
}

/**
 * Referência estável de um item criado por outro projeto.
 *
 * É o que torna a criação idempotente: planejar o mesmo item duas vezes tem
 * de encontrar o item que já existe, não criar um segundo. Sem isto o vizinho
 * acumularia uma cópia por replanejamento — a mesma falha que já fez um item
 * daqui virar 7 PRs (ver o comando `plan` na CLI).
 *
 * O título entra na chave de propósito: um mesmo item de origem pode gerar
 * mais de uma necessidade distinta no vizinho, e essas são itens diferentes.
 */
export function crossProjectExternalRef(input: CrossProjectItemInput): string {
  return [
    'uranus',
    slugPart(input.originProjectName),
    slugPart(input.originItemId),
    slugPart(input.title),
  ].join(':')
}

/**
 * Corpo do item criado no vizinho.
 *
 * Um item que aparece no backlog de alguém sem explicar de onde veio é ruído,
 * não integração: quem abrir `uranus backlog show` do outro lado precisa saber
 * quem pediu, por causa de qual item, e o que exatamente é esperado.
 */
export function crossProjectItemBody(input: CrossProjectItemInput): string {
  return [
    `> Item criado automaticamente pelo Uranus do projeto **${input.originProjectName}**.`,
    `> Origem: item de backlog \`${input.originItemId}\`.`,
    '',
    input.intent,
    '',
    'Ao planejar isto, trate como uma necessidade de integração: o projeto de',
    'origem depende deste comportamento para concluir o trabalho dele.',
  ].join('\n')
}

/**
 * Resolve um caminho e prova que ele ficou DENTRO de `root`.
 *
 * O alias e o caminho do vizinho vêm, respectivamente, de saída de modelo e de
 * um arquivo de configuração — "sair do diretório" é exatamente o que uma
 * injeção tentaria. Fora do root é erro, nunca escrita.
 */
export function resolveInsideRoot(root: string, ...segments: string[]): Result<string> {
  const base = resolve(root)
  const target = resolve(base, ...segments)
  const rel = relative(base, target)
  const escapes = rel !== '' && (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
  if (escapes) {
    return err(
      new ValidationError(
        `Caminho "${join(...segments)}" sai da raiz do projeto vizinho — escrita recusada.`,
        { context: { root: base, target } },
      ),
    )
  }
  return ok(target)
}

/** Diretório de backlog do vizinho, com a guarda de contenção já aplicada. */
export function crossProjectBacklogDir(neighborRoot: string): Result<string> {
  return resolveInsideRoot(neighborRoot, '.uranus', 'backlog')
}

export interface CrossProjectCreateOutcome {
  readonly itemId: string
  /** `false` quando o item já existia — a chamada foi um no-op idempotente. */
  readonly created: boolean
}

/**
 * Cria (ou reencontra) o item no backlog do vizinho.
 *
 * Mesmo critério de deduplicação de `FileBacklogStore.importItems`:
 * `externalRef`. A diferença é que aqui o chamador precisa do **id** do item —
 * para o evento `CrossProjectItemCreated` e para o humano conseguir achá-lo do
 * outro lado — e `importItems` só devolve contagens.
 */
export async function createCrossProjectItem(
  store: Pick<FileBacklogStore, 'list' | 'add'>,
  input: CrossProjectItemInput,
  now: number,
): Promise<Result<CrossProjectCreateOutcome>> {
  const externalRef = crossProjectExternalRef(input)
  const existing = await store.list()
  const known = existing.find((item) => item.externalRef === externalRef)
  if (known !== undefined) return ok({ itemId: known.id, created: false })

  const added = await store.add({
    title: input.title,
    body: crossProjectItemBody(input),
    // O rótulo é o que faz `uranus backlog list --label` do outro lado separar
    // o que veio de fora do que o próprio time escreveu.
    labels: ['cross-project', `origem:${slugPart(input.originProjectName)}`],
    source: 'linked-project',
    externalRef,
    createdAt: now,
  })
  if (!added.ok) return err(added.error)
  return ok({ itemId: added.value.id, created: true })
}

function slugPart(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug === '' ? 'x' : slug
}
