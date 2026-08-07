// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * Fronteiras de dependência entre pacotes (docs/03-TREE.md).
 * Estas regras são o que impede a arquitetura de apodrecer silenciosamente:
 * uma seta invertida no grafo vira erro de lint, não uma descoberta em produção.
 */
const boundaries = [
  {
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@uranus/*'],
              message:
                'core é a raiz do grafo de dependências: não pode importar nenhum outro pacote.',
            },
            {
              group: ['node:fs', 'node:fs/promises', 'node:child_process', 'node:sqlite'],
              message: 'core não faz I/O. Mova para o pacote de implementação correspondente.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/kernel/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@uranus/providers/*',
                '@uranus/executors/*',
                '@uranus/plugins/*',
                '@uranus/vcs/*',
              ],
              message:
                'kernel depende apenas de contratos (@uranus/core). Implementações entram por injeção no composition root.',
            },
          ],
        },
      ],
    },
  },
]

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '**/*.tsbuildinfo'],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // `noUncheckedIndexedAccess` está ligado no tsconfig: todo acesso indexado
      // é `T | undefined`. O `!` após verificação de limites é a alternativa
      // deliberada a espalhar `?? panic()` em loops quentes.
      '@typescript-eslint/no-non-null-assertion': 'off',
      // APIs de fronteira (ConfigReader.get<T>, SqlStatement.get<T>, repositórios)
      // deixam o chamador escolher o tipo de retorno de propósito — é o contrato,
      // não um parâmetro de tipo esquecido.
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
      'no-console': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  ...boundaries,
  {
    files: ['**/*.test.ts', 'packages/testkit/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      'no-console': 'off',
    },
  },
  {
    files: ['*.config.js', '*.config.ts', 'eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },
)
