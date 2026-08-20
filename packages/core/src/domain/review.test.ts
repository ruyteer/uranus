import { describe, expect, it } from 'vitest'
import type { Finding, GatePolicy } from './review.js'
import {
  DEFAULT_GATE_POLICY,
  applyGatePolicy,
  followUpFindings,
  findingFingerprint,
  findingTouches,
  isAtLeastAsSevere,
  planFollowUps,
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

  it('blockAt "never" roda a cadeia e registra achados, mas nunca bloqueia', () => {
    const findings = [finding({ severity: 'critical' }), finding({ id: 'f2', severity: 'low' })]
    const advisory: GatePolicy = { ...DEFAULT_GATE_POLICY, blockAt: 'never' }
    const report = applyGatePolicy('reviewer', findings, advisory, 0)
    expect(report.blocked).toBe(false)
    expect(report.blockingFindings).toHaveLength(0)
    expect(report.findings).toHaveLength(2)
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
  const ACOMPANHA_MEDIUM: GatePolicy = { ...DEFAULT_GATE_POLICY, followUpAt: 'medium' }

  it('devolve os não-bloqueantes acima do limiar de acompanhamento', () => {
    const report = applyGatePolicy(
      'reviewer',
      [
        finding({ id: 'bloq', severity: 'high' }),
        finding({ id: 'segue', severity: 'medium' }),
        finding({ id: 'ignora', severity: 'info' }),
      ],
      ACOMPANHA_MEDIUM,
      0,
    )
    const followUps = followUpFindings(report, ACOMPANHA_MEDIUM)
    expect(followUps.map((f) => f.id)).toEqual(['segue'])
  })

  it('no default, nada não-bloqueante vira acompanhamento', () => {
    // `followUpAt === blockAt` por padrão: o que não parou o merge não gera
    // PR sozinho. Este teste existe para que baixar o default volte a ser uma
    // decisão explícita, e não um efeito colateral de outra mudança.
    const report = applyGatePolicy(
      'reviewer',
      [finding({ id: 'bloq', severity: 'high' }), finding({ id: 'medio', severity: 'medium' })],
      DEFAULT_GATE_POLICY,
      0,
    )
    expect(followUpFindings(report, DEFAULT_GATE_POLICY)).toEqual([])
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

describe('findingFingerprint', () => {
  it('ignora a linha: código que anda não é problema novo', () => {
    const antes = finding({ category: 'sql-injection', file: 'src/db.ts', line: 12 })
    const depois = finding({ category: 'sql-injection', file: 'src/db.ts', line: 84 })
    expect(findingFingerprint(antes)).toBe(findingFingerprint(depois))
  })

  it('ignora pontuação e caixa do título', () => {
    expect(findingFingerprint(finding({ title: 'Falta de validação!' }))).toBe(
      findingFingerprint(finding({ title: 'falta de validacao'.replace('cao', 'ção') })),
    )
  })

  it('separa achados de arquivos diferentes', () => {
    expect(findingFingerprint(finding({ file: 'a.ts' }))).not.toBe(
      findingFingerprint(finding({ file: 'b.ts' })),
    )
  })

  it('separa categorias diferentes no mesmo arquivo', () => {
    expect(findingFingerprint(finding({ category: 'xss', file: 'a.ts' }))).not.toBe(
      findingFingerprint(finding({ category: 'csrf', file: 'a.ts' })),
    )
  })
})

describe('planFollowUps', () => {
  const SEM_MEMORIA = new Set<string>()
  const ACOMPANHA_MEDIUM: GatePolicy = { ...DEFAULT_GATE_POLICY, followUpAt: 'medium' }

  function planeja(
    achados: readonly Finding[],
    overrides: Partial<Parameters<typeof planFollowUps>[0]> = {},
  ): ReturnType<typeof planFollowUps> {
    const policy = overrides.policy ?? ACOMPANHA_MEDIUM
    return planFollowUps({
      report: applyGatePolicy('reviewer', achados, policy, 0),
      generation: 1,
      policy,
      known: SEM_MEMORIA,
      remaining: 10,
      ...overrides,
    })
  }

  it('corta a recorrência na geração máxima', () => {
    const critico = finding({ id: 'c', severity: 'critical' })
    // Geração 1 (filha de task humana) deriva; geração 2 (filha de correção)
    // não. É este corte que dá caso base à cadeia task → revisão → task.
    expect(planeja([critico], { generation: 1 }).spawn).toHaveLength(1)

    const funda = planeja([critico], { generation: 2 })
    expect(funda.spawn).toEqual([])
    expect(funda.deferred.map((d) => d.reason)).toEqual(['generation'])
  })

  it('categoria de estilo informa mas não emprega', () => {
    const plano = planeja([finding({ severity: 'medium', category: 'naming-convention' })])
    expect(plano.spawn).toEqual([])
    expect(plano.deferred.map((d) => d.reason)).toEqual(['category'])
  })

  it('mas achado bloqueante deriva mesmo com categoria vetada', () => {
    // Um `critical` classificado como `style` pelo agente ainda parou o merge;
    // recusar a correção deixaria a task original travada sem saída.
    const plano = planeja([finding({ severity: 'critical', category: 'style' })])
    expect(plano.spawn).toHaveLength(1)
  })

  it('a mesma queixa nunca vira duas tasks', () => {
    const achado = finding({ severity: 'high', category: 'xss', file: 'src/a.ts' })
    const plano = planeja([achado], { known: new Set([findingFingerprint(achado)]) })
    expect(plano.spawn).toEqual([])
    expect(plano.deferred.map((d) => d.reason)).toEqual(['duplicate'])
  })

  it('deduplica também dentro do mesmo relatório', () => {
    const a = finding({ id: 'a', severity: 'high', category: 'xss', file: 'src/a.ts' })
    const b = finding({ id: 'b', severity: 'high', category: 'xss', file: 'src/a.ts' })
    const plano = planeja([a, b])
    expect(plano.spawn).toHaveLength(1)
    expect(plano.deferred.map((d) => d.reason)).toEqual(['duplicate'])
  })

  it('respeita o teto restante do run', () => {
    const achados = [
      finding({ id: '1', severity: 'high', file: 'a.ts' }),
      finding({ id: '2', severity: 'high', file: 'b.ts' }),
      finding({ id: '3', severity: 'high', file: 'c.ts' }),
    ]
    const plano = planeja(achados, { remaining: 2 })
    expect(plano.spawn).toHaveLength(2)
    expect(plano.deferred.map((d) => d.reason)).toEqual(['run-budget'])
  })

  it('abaixo do limiar de acompanhamento vira registro, não trabalho', () => {
    const plano = planeja([finding({ severity: 'low', category: 'perf' })])
    expect(plano.spawn).toEqual([])
    expect(plano.deferred.map((d) => d.reason)).toEqual(['severity'])
  })

  it('todo achado sai classificado — nada evapora', () => {
    const achados = [
      finding({ id: 'bloq', severity: 'critical', file: 'a.ts' }),
      finding({ id: 'segue', severity: 'medium', category: 'perf', file: 'b.ts' }),
      finding({ id: 'estilo', severity: 'medium', category: 'style', file: 'c.ts' }),
      finding({ id: 'baixo', severity: 'low', file: 'd.ts' }),
    ]
    const plano = planeja(achados)
    expect(plano.spawn.length + plano.deferred.length).toBe(achados.length)
  })

  it('exceto `info`, que por definição não pede ação e ficaria só ruidando', () => {
    const plano = planeja([finding({ severity: 'info' })])
    expect(plano.spawn).toEqual([])
    expect(plano.deferred).toEqual([])
  })

  it('no default, achado não-bloqueante nenhum vira task', () => {
    const plano = planeja(
      [
        finding({ id: 'm', severity: 'medium', category: 'bug', file: 'a.ts' }),
        finding({ id: 'l', severity: 'low', category: 'bug', file: 'b.ts' }),
      ],
      { policy: DEFAULT_GATE_POLICY },
    )
    expect(plano.spawn).toEqual([])
    expect(plano.deferred.map((d) => d.reason)).toEqual(['severity', 'severity'])
  })

  it('é pura: mesma entrada, mesmo plano', () => {
    const achados = [finding({ severity: 'high', file: 'a.ts' })]
    expect(planeja(achados)).toEqual(planeja(achados))
  })
})
