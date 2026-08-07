export type Unsubscribe = () => void

export interface HealthReport {
  readonly healthy: boolean
  readonly detail: string
  readonly version?: string
  readonly checkedAt: number
}

export interface Disposable {
  close(): Promise<void>
}

/** Leitor de configuração exposto a plugins — somente leitura, com caminho pontilhado. */
export interface ConfigReader {
  get<T>(path: string): T | undefined
  getOr<T>(path: string, fallback: T): T
  has(path: string): boolean
}

/** Resolve segredos no momento do uso; nunca os coloca em contexto ou log (R12). */
export interface SecretProvider {
  resolve(ref: string): Promise<string | undefined>
  has(ref: string): Promise<boolean>
}
