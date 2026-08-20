/**
 * @uranus/dashboard — servidor do painel web.
 *
 * Lê o estado agregado a partir do log de eventos e empurra atualizações via
 * SSE. Além disso, quando o composition root liga a porta `DashboardData`, o
 * painel também ESCREVE: cria e move tasks, gerencia o backlog e grava a
 * config, exatamente o que o CLI faz — é o pedido de "tudo gerenciado pela
 * dashboard". Nada disso passa direto no kernel: aprovações vão pelo
 * `HumanGate` e as escritas vão pela porta, que é implementada fora daqui.
 *
 * Sem essa porta, o pacote continua sendo o observador puro que sempre foi e as
 * rotas de escrita respondem 503.
 */
export { DashboardServer, uiPath, type DashboardOptions, type DashboardControl } from './server.js'
export {
  CHECK_KINDS,
  type ConfigCategoryLike,
  type ConfigOptionLike,
  type ConfigQuestionLike,
  type DashboardBacklogPort,
  type DashboardConfigPort,
  type DashboardData,
  type DashboardTasksPort,
  type NewTaskInput,
  type StoredBacklogItemLike,
} from './data.js'
export {
  BACKLOG_STATES,
  TASK_STATES,
  backlogItemView,
  backlogProgressView,
  relativeLabel,
  taskStateOptions,
  taskTone,
  taskView,
  type BacklogItemView,
  type BacklogProgressView,
  type TaskBlockReasonView,
  type TaskStateOption,
  type TaskView,
  type ViewTone,
} from './views.js'
export { publicDir, resolvePublicPath, readPublicAsset, type StaticAsset } from './static-files.js'
export { SseHub } from './sse.js'
export { startDashboard, type StartDashboardOptions } from './start.js'
