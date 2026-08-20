import type { Document } from 'yaml'
import { parseDocument, parse as parseYaml } from 'yaml'
import type { Result } from '@uranus/core'
import type { ConfigLayer, UranusConfig } from '@uranus/config'
import { mergeLayers, parseConfig, uranusConfigSchema } from '@uranus/config'
import { type Parsed, parsedOk, parsedProblem } from './prompt-kit.js'

/**
 * Edição do `.uranus/config.yaml` **sem perder o que o humano escreveu**.
 *
 * O YAML continua existindo e continua sendo editado à mão — então o wizard
 * grava com `parseDocument` + `setIn` em vez de reserializar o objeto inteiro.
 * Reescrever do zero apagaria comentários, ordem e formatação: um wizard que
 * come os comentários do usuário é um wizard que ninguém usa duas vezes.
 *
 * O outro compromisso do módulo é nunca gravar um arquivo que não carrega.
 * Config inválida **aborta a inicialização** do Uranus (ver `@uranus/config`),
 * então um wizard que produz YAML inválido é pior que não ter wizard: toda
 * gravação passa por `validateProjectData` antes de tocar o disco.
 */

export type PathSegment = string | number

/** `budget.perRun.usd` → `['budget','perRun','usd']`; índice de lista vira número. */
export function pathSegments(path: string): readonly PathSegment[] {
  return path
    .split('.')
    .filter((segment) => segment !== '')
    .map((segment) => (/^\d+$/.test(segment) ? Number.parseInt(segment, 10) : segment))
}

export function valueAtPath(data: unknown, segments: readonly PathSegment[]): unknown {
  let node: unknown = data
  for (const segment of segments) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<PathSegment, unknown>)[segment]
  }
  return node
}

// ── navegação pelo schema ───────────────────────────────────────────────────

/**
 * O schema visto estruturalmente.
 *
 * `zod` **não é dependência do CLI** e não vai virar uma por causa disto: o que
 * este módulo percorre é a forma do `_def`, o mesmo caminho de qualquer gerador
 * de formulário a partir de schema. Em troca, o CLI consegue responder "este
 * caminho existe?" e "que valores este campo aceita?" sem duplicar o schema —
 * que é justamente o que impede a definição do wizard de apodrecer.
 */
export interface SchemaNode {
  readonly _def: Readonly<Record<string, unknown>>
  safeParse(value: unknown): { readonly success: boolean }
}

function isSchemaNode(value: unknown): value is SchemaNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_def' in value &&
    typeof (value as { safeParse?: unknown }).safeParse === 'function'
  )
}

function typeNameOf(node: SchemaNode): string {
  const name = node._def['typeName']
  return typeof name === 'string' ? name : ''
}

/** Embalagens que não mudam o caminho nem o conjunto de valores aceitos. */
const WRAPPERS: Readonly<Record<string, string>> = {
  ZodDefault: 'innerType',
  ZodOptional: 'innerType',
  ZodNullable: 'innerType',
  ZodCatch: 'innerType',
  ZodReadonly: 'innerType',
  ZodBranded: 'type',
  ZodEffects: 'schema',
}

export function unwrapSchema(node: SchemaNode): SchemaNode {
  let current = node
  for (;;) {
    const key = WRAPPERS[typeNameOf(current)]
    if (key === undefined) return current
    const inner = current._def[key]
    if (!isSchemaNode(inner)) return current
    current = inner
  }
}

function childSchema(node: SchemaNode, segment: PathSegment): SchemaNode | undefined {
  const inner = unwrapSchema(node)
  switch (typeNameOf(inner)) {
    case 'ZodObject': {
      const shape = inner._def['shape']
      if (typeof shape !== 'function') return undefined
      const fields: unknown = (shape as () => unknown)()
      if (fields === null || typeof fields !== 'object') return undefined
      const field = (fields as Record<string, unknown>)[String(segment)]
      return isSchemaNode(field) ? field : undefined
    }
    case 'ZodRecord': {
      // Record de chave enumerada (`validations.rules`) recusa chave que não
      // existe — é o que faz `config set validations.rules.xyz` virar erro.
      const keyType = inner._def['keyType']
      if (isSchemaNode(keyType) && !keyType.safeParse(String(segment)).success) return undefined
      const valueType = inner._def['valueType']
      return isSchemaNode(valueType) ? valueType : undefined
    }
    case 'ZodArray': {
      if (typeof segment !== 'number') return undefined
      const element = inner._def['type']
      return isSchemaNode(element) ? element : undefined
    }
    default:
      return undefined
  }
}

const ROOT_SCHEMA = uranusConfigSchema as unknown as SchemaNode

/** O schema do campo em `path`, ou `undefined` se o caminho não existe. */
export function schemaAt(path: string): SchemaNode | undefined {
  let node: SchemaNode | undefined = ROOT_SCHEMA
  for (const segment of pathSegments(path)) {
    if (node === undefined) return undefined
    node = childSchema(node, segment)
  }
  return node
}

/** Os valores de um campo enumerado — `undefined` quando não é enum. */
export function enumValues(node: SchemaNode): readonly string[] | undefined {
  const inner = unwrapSchema(node)
  if (typeNameOf(inner) !== 'ZodEnum') return undefined
  const values = inner._def['values']
  return Array.isArray(values) ? values.map((value) => String(value)) : undefined
}

/** Valores aceitos por um campo enumerado — direto, ou dentro de uma lista. */
export function allowedValues(node: SchemaNode): readonly string[] | undefined {
  const direto = enumValues(node)
  if (direto !== undefined) return direto
  const inner = unwrapSchema(node)
  if (typeNameOf(inner) !== 'ZodArray') return undefined
  const element = inner._def['type']
  return isSchemaNode(element) ? enumValues(element) : undefined
}

export function numberBoundsOf(node: SchemaNode): { min?: number; max?: number } {
  return numberBounds(unwrapSchema(node))
}

function numberBounds(node: SchemaNode): { min?: number; max?: number } {
  const checks = node._def['checks']
  if (!Array.isArray(checks)) return {}
  const bounds: { min?: number; max?: number } = {}
  for (const check of checks) {
    if (check === null || typeof check !== 'object') continue
    const { kind, value } = check as { kind?: unknown; value?: unknown }
    if (typeof value !== 'number') continue
    if (kind === 'min') bounds.min = value
    if (kind === 'max') bounds.max = value
  }
  return bounds
}

/** O que o campo aceita, em uma frase — entra na mensagem de erro do `config set`. */
export function describeSchema(node: SchemaNode): string {
  const inner = unwrapSchema(node)
  switch (typeNameOf(inner)) {
    case 'ZodEnum':
      return `um de: ${(enumValues(inner) ?? []).join(', ')}`
    case 'ZodBoolean':
      return 'sim ou não (true/false)'
    case 'ZodNumber': {
      const { min, max } = numberBounds(inner)
      if (min !== undefined && max !== undefined) {
        return `número entre ${String(min)} e ${String(max)}`
      }
      if (min !== undefined) return `número a partir de ${String(min)}`
      if (max !== undefined) return `número até ${String(max)}`
      return 'número'
    }
    case 'ZodString':
      return 'texto'
    case 'ZodLiteral':
      return `exatamente ${String(inner._def['value'])}`
    case 'ZodArray': {
      const element = inner._def['type']
      return isSchemaNode(element)
        ? `lista separada por vírgula (${describeSchema(element)})`
        : 'lista separada por vírgula'
    }
    case 'ZodObject':
    case 'ZodRecord':
      return 'objeto — informe em JSON, ou use o caminho completo do campo'
    default:
      return 'valor em JSON'
  }
}

/**
 * Interpreta o valor digitado no `uranus config set` conforme o schema do campo.
 *
 * Sem isto, `config set kernel.concurrency 4` gravaria a string "4" e o próximo
 * `uranus start` morreria na validação — erro corretíssimo, no lugar errado, e
 * com o arquivo já corrompido.
 */
export function coerceRawValue(node: SchemaNode, raw: string): Parsed<unknown> {
  const inner = unwrapSchema(node)
  const texto = raw.trim()
  switch (typeNameOf(inner)) {
    case 'ZodBoolean': {
      const lower = texto.toLowerCase()
      if (['true', 'sim', 's', 'yes', 'y', '1'].includes(lower)) return parsedOk(true)
      if (['false', 'nao', 'não', 'n', 'no', '0'].includes(lower)) return parsedOk(false)
      return parsedProblem(`"${texto}" não é sim nem não.`)
    }
    case 'ZodNumber': {
      const valor = Number.parseFloat(texto.replace(',', '.'))
      return Number.isFinite(valor)
        ? parsedOk(valor)
        : parsedProblem(`"${texto}" não é um número.`)
    }
    case 'ZodLiteral': {
      const literal = inner._def['value']
      if (typeof literal === 'number') {
        const valor = Number.parseFloat(texto)
        return Number.isFinite(valor) ? parsedOk(valor) : parsedProblem(`"${texto}" não é um número.`)
      }
      return parsedOk(texto)
    }
    case 'ZodArray': {
      const element = inner._def['type']
      if (!isSchemaNode(element)) return parsedOk(texto === '' ? [] : texto.split(','))
      const itens: unknown[] = []
      for (const parte of texto === '' || texto === '-' ? [] : texto.split(',')) {
        const item = coerceRawValue(element, parte.trim())
        if (!item.ok) return item
        itens.push(item.value)
      }
      return parsedOk(itens)
    }
    case 'ZodObject':
    case 'ZodRecord': {
      try {
        return parsedOk(JSON.parse(texto))
      } catch {
        return parsedProblem(
          'Este campo é um objeto: passe JSON, ou use o caminho completo do ' +
            'campo que você quer mudar.',
        )
      }
    }
    default:
      return parsedOk(texto)
  }
}

// ── gravação ────────────────────────────────────────────────────────────────

export interface ConfigWrite {
  readonly path: string
  readonly value: unknown
}

/**
 * Garante que os pais do caminho existem **e são válidos** antes de gravar a folha.
 *
 * O `setIn` do `yaml` cria mapa intermediário sozinho, e para quase todo caminho
 * isso basta. A exceção é a seção cujo objeto vazio não valida — `budget.perRun`
 * exige `usd`, `tokens` e `wallclockMs` juntos. Escrever só `usd` num arquivo que
 * ainda não tem a seção produziria `{ usd: 12 }` e o Uranus recusaria carregar a
 * própria configuração que acabou de gravar. Nesses casos a seção inteira é
 * materializada a partir do valor efetivo (que já inclui os defaults).
 */
function ensureParents(
  doc: Document,
  effective: unknown,
  segments: readonly PathSegment[],
): void {
  for (let i = 0; i < segments.length - 1; i++) {
    const prefixo = segments.slice(0, i + 1)
    if (doc.hasIn(prefixo)) continue
    const node = schemaAt(prefixo.join('.'))
    if (node?.safeParse({}).success === true) continue
    const atual = valueAtPath(effective, prefixo)
    if (atual === undefined) continue
    doc.setIn(prefixo, structuredClone(atual))
  }
}

export function applyWrites(
  doc: Document,
  effective: unknown,
  writes: readonly ConfigWrite[],
): void {
  for (const write of writes) {
    const segments = pathSegments(write.path)
    if (segments.length === 0) continue
    ensureParents(doc, effective, segments)
    doc.setIn(segments, write.value)
  }
}

/** Uma cópia independente do documento — usada para só efetivar após validar. */
export function cloneDocument(doc: Document): Document {
  return parseDocument(doc.toString())
}

export function documentToData(doc: Document): Record<string, unknown> {
  const parsed: unknown = parseYaml(doc.toString())
  return parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)
    ? {}
    : (parsed as Record<string, unknown>)
}

/**
 * Valida o arquivo do projeto **na composição em que ele vai ser lido**.
 *
 * Validar o arquivo isolado daria falso negativo em quem completa a config pelo
 * `~/.uranus/config.yaml` ou por `URANUS_*`: o que precisa carregar é o merge
 * das camadas, que é exatamente o que o próximo `loadConfig` vai fazer.
 */
export function validateProjectData(
  data: Record<string, unknown>,
  layers: readonly ConfigLayer[],
): Result<UranusConfig> {
  const outras = layers.filter((layer) => layer.name !== 'project')
  return parseConfig(
    mergeLayers([...outras, { name: 'project', source: '(candidato)', data }]),
  )
}

// ── apresentação de valores ─────────────────────────────────────────────────

/** Comparação estrutural estável — ordem de chave não é diferença de valor. */
export function sameValue(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b)
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
  return `{${entries.join(',')}}`
}

export function formatConfigValue(value: unknown): string {
  if (value === undefined || value === null) return '—'
  if (typeof value === 'boolean') return value ? 'sim' : 'não'
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) {
    return value.length === 0 ? '(nenhum)' : value.map(formatConfigValue).join(', ')
  }
  return JSON.stringify(value)
}
