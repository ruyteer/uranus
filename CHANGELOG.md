# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/). Este projeto ainda
não publicou uma versão 1.0 — os números de versão em `package.json` não seguem semver estrito até
lá; a partir do 1.0, seguem.

## [Não lançado] — Fase 9 (parte 1): paralelismo real e hardening de longa duração

### Adicionado

- **Paralelismo real no kernel.** `kernel.concurrency` (existia na config, nunca era lido) agora é
  honrado: o kernel reclama e executa até N tasks simultaneamente por tick, sobre o mecanismo de
  lease por arquivo que já existia desde a Fase 4 (`fileLeasePolicy`, `SqlTaskQueue.eligible()`).
  Em `concurrency: 1` o comportamento permanece idêntico ao anterior.
- **Enforcement de `maxConcurrentSessions` por provider**, via semáforo em
  `packages/core/src/util/semaphore.ts` / `packages/agents/src/session-limiter.ts` — um provider
  local de GPU única nunca recebe mais sessões simultâneas do que declara, mesmo com
  `kernel.concurrency` alto.
- **Chaos test para tasks concorrentes** (`packages/kernel/src/chaos-concurrent.test.ts`): prova
  recuperação com 2+ tasks ativas simultâneas, serialização correta sob `touches` sobrepostos, e
  concorrência genuína.
- **Poda de eventos JSONL** além de `telemetry.eventRetention.keepSegments` (default 200
  segmentos), aplicada a cada checkpoint.
- **Poda de checkpoint entre runs**: runs terminados além de `runRetentionKeep` têm seus
  checkpoints zerados (histórico de tasks/runs continua intacto).
- **Compactação de memória em escala**: `MarkdownMemoryStore.pruneSuperseded()` (já existia, era
  só CLI opt-in) agora roda automaticamente em `DefaultMemoryManager.maintain()`, com
  `memory.pruneSupersededAfterDays` (default 30).
- **Instrumentação de RSS** por checkpoint (`process.memory_rss_bytes`, exposto em
  `/api/metrics`) e **soak test acelerado** (`packages/kernel/src/soak.test.ts`) que prova ausência
  de crescimento linear de memória ao longo de centenas de tasks.
- **Teste de multi-projeto** (`packages/kernel/src/multi-project.test.ts`): duas pilhas completas
  de kernel rodando concorrentemente no mesmo processo, provando isolamento total sem nenhuma
  reescrita de arquitetura — multi-projeto simultâneo continua sendo multi-processo.
- `KernelStatus.workers`: lista de todas as tasks em voo agora (substitui a suposição de "uma task
  por vez" nos campos `currentTask`/`currentAgent`, mantidos por compatibilidade quando há
  exatamente 1 worker ativo).

### Corrigido

- **`this.stopRequested` nunca era resetado em `Kernel.start()`** — reiniciar o mesmo kernel depois
  de um drain nunca funcionava de verdade (todo `start()` seguinte terminava no tick 0 sem
  processar nada). Achado pelo próprio soak test desta fase.
- **`BudgetGuard.task` corrompia sob execução concorrente** — duas tasks resetando/consumindo a
  mesma janela de orçamento compartilhada misturava custo de uma na outra. `consume()` agora só
  escreve no acumulador do run; `state().task.usedCost` fica honestamente zerado sob N-concorrência
  em vez de reportar um valor cruzado.
- **`recentOutcomes` (kernel) crescia sem limite** — só era truncado na leitura, nunca na escrita.
  Agora tem cap de 200 no `push`.

### Não incluído nesta entrega, deliberadamente

- Benchmark real de 8h contra um provider pago — consome orçamento e tempo reais; fica como
  validação manual para o mantenedor rodar quando quiser. O soak test acelerado prova a ausência
  de vazamento sem esse custo.
- 3 projetos em paralelo como processos de SO reais — provado por 2 instâncias in-process; falta a
  prova de campo.
- Multi-tenancy real dentro de um único processo (particionar toda query por `project_id`) —
  mudança bem maior, fora de escopo desta entrega.
- Site público e guia de migração.
