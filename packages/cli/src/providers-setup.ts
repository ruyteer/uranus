import type { Clock, Logger, ShellRunner } from '@uranus/core'
import type { UranusConfig } from '@uranus/config'
import { defaultSecretProvider } from '@uranus/config'
import {
  ClaudeCodeProvider,
  buildPreset,
  isPresetName,
  type DefaultProviderRegistry,
} from '@uranus/providers'

export interface RegisterProvidersOptions {
  readonly config: UranusConfig
  readonly registry: DefaultProviderRegistry
  readonly shell: ShellRunner
  readonly clock: Clock
  readonly logger: Logger
}

/**
 * Instancia e registra os providers declarados na configuração.
 *
 * Duas garantias que valem o código extra:
 *
 * 1. **A chave de API é resolvida aqui, no momento do uso** — via `apiKeyRef`
 *    (`env:MINHA_CHAVE`), nunca escrita na config. O `SecretProvider` registra
 *    o valor para redação automática, então ela não vaza em log nem em stdout
 *    de subprocesso (R12).
 *
 * 2. **Provider que falha ao instanciar não derruba o kernel.** Um preset
 *    inválido ou uma chave ausente vira aviso e o provider fica de fora; os
 *    outros continuam funcionando, e o roteador pula o que não existe.
 */
export async function registerConfiguredProviders(
  options: RegisterProvidersOptions,
): Promise<void> {
  const { config, registry, shell, clock, logger } = options
  const secrets = defaultSecretProvider()
  const entries = Object.entries(config.providers.entries)

  // Sem nenhuma entrada declarada, o comportamento histórico vale: Claude Code.
  if (entries.length === 0) {
    registry.register(new ClaudeCodeProvider({ shell, logger }))
    return
  }

  for (const [id, entry] of entries) {
    try {
      if (entry.mode === 'cli') {
        registry.register(
          new ClaudeCodeProvider({
            shell,
            logger,
            ...(entry.binary === undefined ? {} : { binary: entry.binary }),
            ...(entry.model === undefined ? {} : { defaultModel: entry.model }),
            extraArgs: entry.extraArgs,
          }),
        )
        continue
      }

      const presetName = entry.preset ?? id
      if (!isPresetName(presetName)) {
        logger.warn('Preset de provider desconhecido; ignorado', {
          provider: id,
          preset: presetName,
        })
        continue
      }

      const apiKey =
        entry.apiKeyRef === undefined ? undefined : await secrets.resolve(entry.apiKeyRef)
      if (entry.apiKeyRef !== undefined && apiKey === undefined) {
        logger.warn('Chave de API não resolvida; provider ignorado', {
          provider: id,
          ref: entry.apiKeyRef,
        })
        continue
      }

      const provider = buildPreset(presetName, {
        shell,
        clock,
        logger,
        ...(apiKey === undefined ? {} : { apiKey }),
        ...(entry.model === undefined ? {} : { model: entry.model }),
        ...(entry.baseUrl === undefined ? {} : { baseUrl: entry.baseUrl }),
        ...(entry.temperature === undefined ? {} : { temperature: entry.temperature }),
        ...(entry.requestTimeoutMs === undefined
          ? {}
          : { requestTimeoutMs: entry.requestTimeoutMs }),
      })
      registry.register(provider)
      logger.debug('Provider registrado', { provider: provider.id, preset: presetName })
    } catch (error: unknown) {
      logger.warn('Provider falhou ao inicializar; ignorado', {
        provider: id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (registry.list().length === 0) {
    logger.warn('Nenhum provider registrado; caindo para Claude Code')
    registry.register(new ClaudeCodeProvider({ shell, logger }))
  }
}
