import type { PluginManifest } from '@uranus/core'
import { commandCheck, definePlugin, fileContextSource, type PluginContext } from '../sdk.js'

/**
 * Plugin `docker`.
 *
 * Registra apenas checks — nenhum agente. Nem toda stack precisa de um agente
 * especializado: um Dockerfile quebrado é um problema de verificação, não de
 * conhecimento de domínio.
 *
 * `docker:build` é caro e não é ativado sozinho em nenhuma task; ele existe
 * para que um plano possa citá-lo quando a mudança realmente toca a imagem.
 */

const MANIFEST: PluginManifest = {
  id: 'docker',
  name: 'Docker',
  version: '1.0.0',
  uranus: '^0.1.0',
  description: 'Checks de build de imagem e de sintaxe de compose para projetos com Docker.',
  provides: {
    checks: ['docker:build', 'docker:compose-config'],
    contextSources: ['docker-files'],
  },
  permissions: { fs: 'read', net: false, exec: true, secrets: [] },
  detect: [
    { kind: 'file', path: 'Dockerfile' },
    { kind: 'file', path: 'docker-compose.yml' },
    { kind: 'file', path: 'compose.yaml' },
  ],
}

export default definePlugin(MANIFEST, (context: PluginContext) => {
  const tag = context.config.getOr<string>('imageTag', 'uranus-verify:latest')

  context.registerCheck(
    commandCheck(context, {
      id: 'docker:build',
      run: `docker build -t ${tag} .`,
      timeoutMs: 900_000,
    }),
  )

  // `config` valida o compose sem subir nada. É o check barato do par: pega
  // YAML inválido e variável não resolvida em segundos.
  context.registerCheck(
    commandCheck(context, {
      id: 'docker:compose-config',
      run: 'docker compose config --quiet',
      timeoutMs: 60_000,
    }),
  )

  context.registerContextSource(
    fileContextSource({
      id: 'docker-files',
      files: ['Dockerfile', 'docker-compose.yml', 'compose.yaml', '.dockerignore'],
      title: (path) => `Docker: ${path}`,
      maxChars: 4_000,
      priority: 40,
    }),
  )
})
