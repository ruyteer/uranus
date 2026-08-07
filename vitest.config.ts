import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const packagesDir = fileURLToPath(new URL('./packages', import.meta.url))

export default defineConfig({
  resolve: {
    // Mapeia @uranus/* direto para o fonte. Sem isto o vitest resolveria para
    // `dist/` — e a suíte testaria um build velho em vez do código editado.
    alias: [
      {
        find: /^@uranus\/([a-z-]+)$/,
        replacement: `${packagesDir}/$1/src/index.ts`,
      },
    ],
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
        'packages/cli/**', // fiação fina sobre módulos já testados; e2e cobre
        'packages/kernel/src/test-stack.ts', // harness de teste, não produto
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
