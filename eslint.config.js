import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/dist/**',
    // the static online demo build (apps/web/dist-demo): generated, minified
    '**/dist-demo/**',
    '**/dist-test/**',
    '**/node_modules/**',
    '**/coverage/**',
    '.exitos/**',
    'playwright-report/**',
    'test-results/**',
    'docs/assets/**',
    // A tiny CommonJS preload used only by the spawned-process test; not part of the TS project.
    'apps/cli/test/block-network.cjs',
  ]),
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            '*.config.ts',
            '*.config.js',
            'scripts/*.mjs',
            'vitest.global-setup.ts',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The brief forbids `any`. Use `unknown` and narrow with Zod.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      // Interface-conforming async methods often have nothing to await.
      '@typescript-eslint/require-await': 'off',
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
    },
  },
  {
    files: ['**/test/**/*.ts', '**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    // The CLI is the only place that prints to the terminal.
    files: ['apps/cli/**/*.ts', 'scripts/**', 'e2e/**'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        fetch: 'readonly',
      },
    },
  },
);
