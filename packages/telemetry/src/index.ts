/**
 * @uranus/telemetry — métricas, custo real e estado vivo do sistema.
 *
 * Tudo aqui é derivado do log de eventos (INV-3). Nenhum componente precisa
 * chamar a telemetria para que ela funcione, e desligá-la não muda o
 * comportamento do kernel em nada.
 */

export * from './pricing.js'
export * from './cost.js'
export * from './metrics.js'
export * from './accounting.js'
export * from './aggregator.js'
export * from './otlp.js'
