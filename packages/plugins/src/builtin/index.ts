import type { Plugin } from '@uranus/core'
import dockerPlugin from './docker.js'
import nextjsPlugin from './nextjs.js'
import nodePlugin from './node.js'

/**
 * Plugins que acompanham o framework.
 *
 * Eles não são privilegiados em relação a plugins de terceiro: usam o mesmo SDK
 * e a mesma superfície `PluginContext`. A única diferença é que já vêm em
 * memória — não passam por import dinâmico nem por varredura de capacidades,
 * porque são o mesmo código que o kernel, com a mesma confiança.
 *
 * Um plugin de projeto com o mesmo `id` substitui o builtin (ver a ordem de
 * precedência em `loader.ts`).
 */
export const BUILTIN_PLUGINS: readonly Plugin[] = [nodePlugin, nextjsPlugin, dockerPlugin]

export { dockerPlugin, nextjsPlugin, nodePlugin }
