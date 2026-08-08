import { describe, expect, it } from 'vitest'
import type { Finding, GatePolicy } from './review.js'
import {
  DEFAULT_GATE_POLICY,
  applyGatePolicy,
  followUpFindings,
  findingTouches,
  isAtLeastAsSevere,
  severityRank,
} from './review.js'

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    severity: 'medium',
    category: 'exemplo',
    title: 'Título do achado',
    detail: 'Descrição suficientemente longa do problema encontrado.',
    ...overrides,
  }
}

describe('severidade', () => {
  it('ordena da mais grave para a menos grave', () => {
    expect(severityRank('critical')).toBeLessThan(severityRank('high'))
    expect(severityRank('high')).toBeLessThan(severityRank('medium'))
    expect(severityRank('low')).toBeLessThan(severityRank('info'))
  })

  it('compara corretamente contra um limiar', () => {
    expect(isAtLeastAsSevere('critical', 'high')).toBe(true)
    expect(isAtLeastAsSevere('high', 'high')).toBe(true)
    expect(isAtLeastAsSevere('medium', 'high')).toBe(false)
  })
})

describe('applyGatePolicy — o harness decide, não o agente (INV-1)', () => {
  it('bloqueia a partir da severidade configurada', () => {
    const report = applyGatePolicy(
      'reviewer',
      [finding({ severity: 'critical' }), finding({ id: 'f2', severity: 'low' })],
      DEFAULT_GATE_POLICY,
      100,
    )
    expect(report.blocked).toBe(true)
    expect(report.blockingFindings).toHaveLength(1)
    expect(report.blockingFindings[0]!.severity).toBe('critical')
  })

  it('não bloqueia quando tudo está abaixo do limiar', () => {
    const report = applyGatePolicy(
      'reviewer',
      [finding({ severity: 'medium' }), finding({ id: 'f2', severity: 'low' })],
      DEFAULT_GATE_POLICY,
      100,
    )
    expect(report.blocked).toBe(false)
    expect(report.blockingFindings).toHaveLength(0)
  })

  it('lista vazia nunca bloqueia', () => {
    expect(applyGatePolicy('qa', [], DEFAULT_GATE_POLICY, 10).blocked).toBe(false)
  })

  it('a política é configurável — o mesmo achado bloqueia ou não conforme o projeto', () => {
    const findings = [finding({ severity: 'medium' })]
    const permissiva: GatePolicy = { ...DEFAULT_GATE_POLICY, blockAt: 'critical' }
    const estrita: GatePolicy = { ...DEFAULT_GATE_POLICY, blockAt: 'medium' }

    expect(applyGatePolicy('r', findings, permissiva, 0).blocked).toBe(false)
    expect(applyGatePolicy('r', findings, estrita, 0).blocked).toBe(true)
  })

  it('ordena por severidade e respeita o teto de findings', () => {
    const many = [
      finding({ id: 'a', severity: 'low' }),
      finding({ id: 'b', severity: 'critical' }),
      finding({ id: 'c', severity: 'medium' }),
    ]
    const report = applyGatePolicy('r', many, { ...DEFAULT_GATE_POLICY, maxFindings: 2 }, 0)
    expect(report.findings).toHaveLength(2)
    // Os mais graves sobrevivem ao corte.
    expect(report.findings.map((f) => f.severity)).toEqual(['critical', 'medium'])
  })

  it('a decisão é determinística: mesmos findings, mesma decisão', () => {
    const findings = [finding({ severity: 'high' }), finding({ id: 'f2', severity: 'low' })]
    const first = applyGatePolicy('r', findings, DEFAULT_GATE_POLICY, 0)
    const second = applyGatePolicy('r', findings, DEFAULT_GATE_POLICY, 0)
    expect(first.blocked).toBe(second.blocked)
    expect(first.blockingFindings).toEqual(second.blockingFindings)
  })
})

describe('followUpFindings', () => {
  it('devolve os não-bloqueantes acima do limiar de acompanhamento', () => {
    const report = applyGatePolicy(
      'reviewer',
      [
        finding({ id: 'bloq', severity: 'high' }),
        finding({ id: 'segue', severity: 'medium' }),
        finding({ id: 'ignora', severity: 'info' }),
      ],
      DEFAULT_GATE_POLICY,
      0,
    )
    const followUps = followUpFindings(report, DEFAULT_GATE_POLICY)
    expect(followUps.map((f) => f.id)).toEqual(['segue'])
  })
})

describe('findingTouches', () => {
  it('usa o arquivo do achado quando disponível', () => {
    expect(findingTouches(finding({ file: 'src/api.ts' }), ['src/**'])).toEqual(['src/api.ts'])
  })

  it('cai para o escopo da task quando o achado não aponta arquivo', () => {
    expect(findingTouches(finding(), ['src/**'])).toEqual(['src/**'])
  })
})
