/**
 * @uranus/dashboard — servidor do painel web.
 *
 * Observador puro: lê o estado agregado a partir do log de eventos e empurra
 * atualizações via SSE. As únicas escritas que ele permite são as que precisam
 * de um humano — conceder ou negar uma aprovação — e mesmo essas passam pelo
 * `HumanGate`, nunca direto no kernel.
 */
export { DashboardServer, uiPath, type DashboardOptions, type DashboardControl } from './server.js'
export { SseHub } from './sse.js'
export { startDashboard, type StartDashboardOptions } from './start.js'
