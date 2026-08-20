import type { PlanId, ProjectId } from '../ids.js'
import type { TaskDraft } from './task.js'

/**
 * Um `Plan` é **dado**, não controle (ADR-002).
 *
 * O agente `Planner` produz esta estrutura via saída estruturada; ela passa por
 * um validador determinístico (`@uranus/backlog`) antes de virar `Task[]`. Plano
 * inválido é rejeitado sem jamais tocar o repositório — essa é a fronteira exata
 * onde o modelo para de ter influência sobre o fluxo.
 */
export interface Plan {
  readonly id: PlanId
  readonly projectId: ProjectId
  readonly sourceItemId: string
  readonly summary: string
  /** Por que este recorte de tarefas, e não outro. Vira memória `decision`. */
  readonly rationale: string
  readonly tasks: readonly TaskDraft[]
  readonly risks: readonly string[]
  readonly assumptions: readonly string[]
  readonly createdBy: string
  readonly createdAt: number
}

export type PlanRejectionCode =
  | 'empty'
  | 'too-large'
  | 'cyclic-dependency'
  | 'unknown-dependency'
  | 'missing-acceptance'
  | 'unenforceable-acceptance'
  | 'paths-out-of-scope'
  | 'invalid-task-kind'
  | 'schema-mismatch'
  /**
   * O plano declarou trabalho para um projeto vizinho que não existe, ou que
   * não deu permissão de escrita no backlog.
   *
   * É rejeição, e não descarte silencioso: o alias vem de saída de modelo, e
   * aceitar o plano ignorando a metade cross-project faria o Uranus dizer
   * "planejei" tendo jogado fora justamente a parte que depende do vizinho.
   */
  | 'unknown-cross-project'

export interface PlanRejection {
  readonly code: PlanRejectionCode
  readonly message: string
  readonly taskIndex?: number
  readonly detail?: Readonly<Record<string, unknown>>
}

export interface BacklogItem {
  readonly id: string
  readonly projectId: ProjectId
  readonly title: string
  readonly body: string
  readonly labels: readonly string[]
  readonly priority: number
  /**
   * `review`: achado de gate que a política não promoveu a task automática.
   * `linked-project`: criado pelo Uranus de um projeto vizinho (categoria ④) —
   * é o que faz `uranus backlog list` mostrar "isto veio do frontend" em vez
   * de um item órfão que ninguém sabe de onde saiu.
   */
  readonly source: 'file' | 'github' | 'gitlab' | 'linear' | 'manual' | 'review' | 'linked-project'
  readonly externalRef?: string
  readonly createdAt: number
}
