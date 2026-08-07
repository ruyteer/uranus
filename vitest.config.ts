import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Os pacotes declaram a condição `uranus-source` apontando para `src/`.
    // Sem isto, rodar a suíte exigiria `tsc -b` antes de cada execução.
    conditions: ['uranus-source'],
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    // Testes tocam o filesystem (event store, sqlite, worktrees). Isolar por arquivo
    // evita corrida por diretório temporário compartilhado.
    pool: 'forks',
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/index.ts',
        '**/contracts/**', // type-only: sem código executável
        'packages/testkit/**', // ferramenta de teste, não produto
      ],
      // INV do roadmap: kernel/core >= 90%, demais >= 80%.
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
        'packages/core/src/**': {
          lines: 90,
          functions: 90,
          branches: 85,
          statements: 90,
        },
        'packages/state/src/**': {
          lines: 90,
          functions: 90,
          branches: 85,
          statements: 90,
        },
      },
    },
  },
})
