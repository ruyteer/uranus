/**
 * @uranus/plugins — carregamento, isolamento e SDK de plugins (ADR-010).
 *
 * O ponto de extensão do framework. Um plugin registra capacidades numa
 * superfície fechada (`PluginContext`) e nunca alcança o kernel, o state store
 * ou o event store bruto.
 *
 * Autores de plugin importam de `@uranus/plugins/sdk`, não daqui.
 */

export * from './manifest.js'
export * from './detect.js'
export * from './capability-scan.js'
export * from './registry.js'
export * from './context.js'
export * from './loader.js'
export { BUILTIN_PLUGINS } from './builtin/index.js'
