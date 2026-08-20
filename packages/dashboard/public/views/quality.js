/** Aba Qualidade — gates, bloqueios e achados de revisão. */
import { h } from '../lib/dom.js'
import { card, cellTitle, empty, kpis, page, pageHead, pill, table } from '../lib/ui.js'
import { asArray } from '../lib/aggregate.js'
import { pct, time } from '../lib/format.js'

export const meta = {
  id: 'qualidade',
  label: 'Qualidade',
  group: 'Acompanhar',
  icon: 'badge',
  needs: ['state'],
}

const COLUMNS = [
  { label: 'Quando' },
  { label: 'Origem' },
  { label: 'Severidade' },
  { label: 'Achado' },
  { label: 'Task' },
]

/** Severidade de achado vem crua do gate; o tom é decisão de cor, não tradução. */
function severityTone(severity) {
  return severity === 'critical' || severity === 'high'
    ? 'danger'
    : severity === 'medium'
      ? 'warning'
      : 'neutral'
}

export function render(ctx) {
  const quality = ctx.snap().quality ?? {}
  const findings = asArray(quality.findings)
  const critical = findings.filter(
    (finding) => finding.severity === 'critical' || finding.severity === 'high',
  ).length

  return page(
    pageHead({
      title: 'Qualidade',
      description: 'O que os gates barraram antes de virar commit.',
    }),
    kpis([
      {
        label: 'Checks aprovados',
        value: quality.passRate === undefined || quality.passRate === null ? '—' : pct(quality.passRate),
        hint: quality.checks
          ? `${String(quality.checks.passed ?? 0)} ok · ${String(quality.checks.failed ?? 0)} falhas`
          : 'Nenhuma verificação rodou ainda.',
        tone: quality.passRate !== undefined && quality.passRate < 0.8 ? 'danger' : 'success',
        iconName: 'badge',
      },
      {
        label: 'Gates executados',
        value: quality.gatesRun ?? 0,
        hint: 'Revisor, segurança e QA somados.',
        tone: 'neutral',
        iconName: 'shield',
      },
      {
        label: 'Integrações barradas',
        value: quality.blocked ?? 0,
        hint: 'Trabalho que não entrou no repositório.',
        tone: (quality.blocked ?? 0) > 0 ? 'warning' : 'success',
        iconName: 'alert',
      },
      {
        label: 'Achados graves',
        value: critical,
        hint: `${String(findings.length)} achados no total`,
        tone: critical > 0 ? 'danger' : 'neutral',
        iconName: 'eye',
      },
    ]),
    card({
      title: 'Achados',
      flush: findings.length > 0,
      body:
        findings.length === 0
          ? empty({
              iconName: 'badge',
              title: 'Nenhum achado registrado',
              description:
                'Os gates de revisão publicam aqui o que encontram. Sem achados e sem gates ' +
                'executados, confira em Configuração se a revisão está ligada.',
            })
          : table(
              COLUMNS,
              findings.map((finding) =>
                h(
                  'tr',
                  null,
                  h('td', { class: 'mono dim nowrap' }, time(finding.at)),
                  h('td', { class: 'mono' }, finding.kind ?? '—'),
                  h('td', null, pill(finding.severity ?? '—', severityTone(finding.severity))),
                  h('td', null, cellTitle(finding.title ?? '—', finding.detail ?? undefined)),
                  h('td', { class: 'mono dim' }, finding.taskId ?? '—'),
                ),
              ),
            ),
    }),
  )
}
