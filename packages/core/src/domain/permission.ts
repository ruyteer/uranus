import type { ApprovalId, TaskId } from '../ids.js'
import type { Glob } from '../util/glob.js'
import type { DiffSummary } from './vcs.js'

/**
 * Permissões: deny-by-default em três eixos (ferramentas, filesystem, rede).
 *
 * A propriedade que importa é a **monotonicidade**: a interseção de camadas
 * (agente ∩ plugin ∩ projeto ∩ global) só pode restringir, nunca ampliar. Se
 * algum caminho de composição pudesse ampliar, um plugin conseguiria escalar os
 * próprios privilégios — que é exatamente o que R17 descreve.
 */
export interface PermissionSet {
  readonly tools: { readonly allow: readonly string[]; readonly deny: readonly string[] }
  readonly fs: {
    readonly read: readonly Glob[]
    readonly write: readonly Glob[]
    readonly deny: readonly Glob[]
  }
  readonly network: { readonly allow: readonly string[] } | false
  readonly exec: { readonly allow: readonly string[] } | false
  readonly secrets: { readonly allow: readonly string[] }
}

/** Nada permitido. Ponto de partida de qualquer composição. */
export const DENY_ALL: PermissionSet = Object.freeze({
  tools: Object.freeze({ allow: [] as readonly string[], deny: [] as readonly string[] }),
  fs: Object.freeze({
    read: [] as readonly Glob[],
    write: [] as readonly Glob[],
    deny: [] as readonly Glob[],
  }),
  network: false,
  exec: false,
  secrets: Object.freeze({ allow: [] as readonly string[] }),
})

function isWildcardList(list: readonly string[]): boolean {
  // `*` (ferramentas/exec) e `**` (globs de fs) significam "tudo".
  return list.includes('*') || list.includes('**')
}

function intersectLists(a: readonly string[], b: readonly string[]): readonly string[] {
  // "Tudo" ∩ X = X. Fora do caso curinga, interseção literal — que é
  // deliberadamente conservadora: dois globs parciais distintos não se
  // intersectam aqui mesmo que possam casar arquivos em comum, porque a
  // permissão resultante deve ser NO MÁXIMO tão ampla quanto cada camada.
  if (isWildcardList(a)) return b
  if (isWildcardList(b)) return a
  const set = new Set(b)
  return a.filter((item) => set.has(item))
}

function unionLists(a: readonly string[], b: readonly string[]): readonly string[] {
  return [...new Set([...a, ...b])]
}

/**
 * Interseção de duas camadas de permissão.
 *
 * `allow` intersecta (restringe), `deny` une (restringe). As duas direções
 * apontam para o mesmo lado — é isto que garante a monotonicidade.
 */
export function intersectPermissions(a: PermissionSet, b: PermissionSet): PermissionSet {
  return {
    tools: {
      allow: intersectLists(a.tools.allow, b.tools.allow),
      deny: unionLists(a.tools.deny, b.tools.deny),
    },
    fs: {
      read: intersectLists(a.fs.read, b.fs.read),
      write: intersectLists(a.fs.write, b.fs.write),
      deny: unionLists(a.fs.deny, b.fs.deny),
    },
    network:
      a.network === false || b.network === false
        ? false
        : { allow: intersectLists(a.network.allow, b.network.allow) },
    exec:
      a.exec === false || b.exec === false
        ? false
        : { allow: intersectLists(a.exec.allow, b.exec.allow) },
    secrets: { allow: intersectLists(a.secrets.allow, b.secrets.allow) },
  }
}

export function intersectAll(layers: readonly PermissionSet[]): PermissionSet {
  if (layers.length === 0) return DENY_ALL
  return layers.reduce(intersectPermissions)
}

export type PermissionEffect = 'allow' | 'deny' | 'ask'

export interface PermissionRequest {
  readonly axis: 'tool' | 'fs-read' | 'fs-write' | 'network' | 'exec' | 'secret'
  readonly subject: string
  readonly taskId?: TaskId
  readonly agent?: string
}

export type PermissionDecision =
  | { readonly effect: 'allow' }
  | { readonly effect: 'deny'; readonly reason: string }
  | { readonly effect: 'ask'; readonly approval: ApprovalRequest }

export type ApprovalKind =
  | 'merge'
  | 'command'
  | 'dependency'
  | 'migration'
  | 'ci-change'
  | 'budget'
  | 'force-push'
  | 'secret-access'
  | 'custom'

export interface ApprovalRequest {
  readonly id: ApprovalId
  readonly kind: ApprovalKind
  readonly title: string
  readonly detail: string
  readonly diff?: DiffSummary
  readonly risk: 'low' | 'medium' | 'high'
  readonly taskId?: TaskId
  readonly requestedAt: number
  readonly expiresAt?: number
  /**
   * Nunca `allow`. Uma aprovação que se concede sozinha por timeout não é
   * supervisão humana — é a ausência dela com aparência de processo.
   */
  readonly defaultOnTimeout: 'deny' | 'defer'
}

export type ApprovalDecision =
  | { readonly effect: 'granted'; readonly by: string; readonly at: number; readonly note?: string }
  | { readonly effect: 'denied'; readonly by: string; readonly at: number; readonly reason: string }

/** Ações que exigem aprovação humana por padrão (§15.2 da arquitetura). */
export const DEFAULT_APPROVAL_REQUIRED: readonly ApprovalKind[] = Object.freeze([
  'merge',
  'force-push',
  'ci-change',
  'migration',
  'dependency',
  'budget',
  'secret-access',
])
