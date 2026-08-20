/**
 * Cliente da API REST do painel.
 *
 * O contrato é o de `cat5-design.md`: erro é sempre `{ error: string }` com o
 * status certo (400 validação, 404 inexistente, 409 conflito, 503 porta de
 * dados ausente). Este módulo transforma isso em `ApiError` com a MENSAGEM DO
 * SERVIDOR preservada — quem chama é obrigado a ter algo para mostrar. Um
 * PATCH que falha em silêncio é pior que um botão desabilitado.
 */

const token = new URLSearchParams(location.search).get('token') ?? ''

/** O token viaja na query porque é assim que o servidor já o aceita hoje. */
export const qs = token === '' ? '' : `?token=${encodeURIComponent(token)}`

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }

  /**
   * 503 é o caso "a dashboard subiu sem a porta de dados". Não é defeito nem
   * erro do usuário: é o painel em modo leitura, e a UI esconde a escrita em
   * vez de mostrar um erro vermelho a cada carregamento.
   */
  get unavailable() {
    return this.status === 503
  }
}

async function request(method, path, body) {
  let response
  try {
    response = await fetch(path + qs, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch {
    throw new ApiError('Sem conexão com o servidor do painel.', 0)
  }

  const text = await response.text()
  let payload
  try {
    payload = text === '' ? {} : JSON.parse(text)
  } catch {
    payload = {}
  }

  if (!response.ok) {
    const message =
      typeof payload?.error === 'string' && payload.error !== ''
        ? payload.error
        : `Falha ${String(response.status)} em ${method} ${path}`
    throw new ApiError(message, response.status)
  }
  return payload
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  patch: (path, body) => request('PATCH', path, body),
  del: (path) => request('DELETE', path),
}

export function apiPath(base, id) {
  return `${base}/${encodeURIComponent(id)}`
}
