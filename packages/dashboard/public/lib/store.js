/**
 * Estado do cliente — um cache de recursos da API e um sinal de mudança.
 *
 * Não é um framework de estado: é um `Map` de `nome → { status, data, error }`
 * com assinantes. A escolha vem da mesma decisão que o resto do painel (sem
 * bundler, sem framework): o que precisa existir é "carregou / está
 * carregando / falhou / o servidor não tem a porta de dados", e isso são
 * quatro estados, não uma biblioteca.
 */
import { api, ApiError } from './api.js'

/** Rotas de leitura. Nomes são o contrato interno usado por `meta.needs`. */
export const PATHS = {
  state: '/api/state',
  tasks: '/api/tasks',
  backlog: '/api/backlog',
  config: '/api/config',
  validations: '/api/validations',
  chat: '/api/claude-activity',
  instructions: '/api/instructions',
  skills: '/api/skills',
  vault: '/api/vault',
  graphify: '/api/graphify',
  memory: '/api/memory',
  github: '/api/github',
  terminals: '/api/terminals',
}

const EMPTY = Object.freeze({ status: 'idle', data: undefined, error: undefined })

const listeners = new Set()
const inflight = new Map()

export const store = {
  /** @type {Record<string, {status:string,data?:unknown,error?:Error}>} */
  res: {},
  /** Fluxo SSE ligado. */
  live: false,
  /** Nome do último evento recebido — vira o rodapé da sidebar. */
  lastEvent: undefined,
}

export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function emit() {
  for (const listener of listeners) listener()
}

export function resource(name) {
  return store.res[name] ?? EMPTY
}

export function dataOf(name, fallback) {
  return resource(name).data ?? fallback
}

/**
 * A porta de dados existe para este recurso?
 *
 * 503 é a resposta combinada quando a dashboard subiu sem `DashboardData`.
 * Quem pergunta é a UI, para esconder os controles de escrita — e continuar
 * mostrando o que já sabe, porque o painel de leitura nunca deixou de valer.
 */
export function writable(name) {
  return resource(name).status !== 'unavailable'
}

/**
 * Carrega (ou recarrega) um recurso.
 *
 * O dado anterior sobrevive à recarga de propósito: com o SSE atualizando a
 * cada rajada de eventos, esvaziar antes de buscar faria a tela piscar
 * esqueleto várias vezes por segundo.
 */
export async function load(name, force = false) {
  const path = PATHS[name]
  if (path === undefined) return
  const running = inflight.get(name)
  if (running !== undefined && !force) return running

  const previous = resource(name)
  if (previous.data === undefined) store.res[name] = { status: 'loading' }

  const promise = api
    .get(path)
    .then((data) => {
      store.res[name] = { status: 'ready', data }
    })
    .catch((error) => {
      const unavailable = error instanceof ApiError && error.unavailable
      store.res[name] = {
        status: unavailable ? 'unavailable' : 'error',
        error,
        // Mantém o último dado bom: um erro de rede momentâneo não deve apagar
        // a tela que a pessoa está lendo.
        ...(previous.data === undefined ? {} : { data: previous.data }),
      }
    })
    .finally(() => {
      inflight.delete(name)
      emit()
    })

  inflight.set(name, promise)
  return promise
}

export function loadAll(names, force = false) {
  return Promise.all(names.map((name) => load(name, force)))
}
