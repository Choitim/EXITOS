import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

/**
 * Tests import workspace packages by name. Aliasing them to their TypeScript sources means
 * `pnpm test` works on a fresh checkout without building first.
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@exitos\/shared$/, replacement: src('./packages/shared/src/index.ts') },
      { find: /^@exitos\/core\/schema$/, replacement: src('./packages/core/src/schema/index.ts') },
      { find: /^@exitos\/core\/sdk$/, replacement: src('./packages/core/src/sdk/index.ts') },
      {
        find: /^@exitos\/core\/testing$/,
        replacement: src('./packages/core/src/testing/index.ts'),
      },
      { find: /^@exitos\/core$/, replacement: src('./packages/core/src/index.ts') },
      {
        find: /^@exitos\/connector-notion\/testing$/,
        replacement: src('./packages/connector-notion/src/testing/index.ts'),
      },
      {
        find: /^@exitos\/connector-notion$/,
        replacement: src('./packages/connector-notion/src/index.ts'),
      },
      {
        find: /^@exitos\/connector-clickup\/testing$/,
        replacement: src('./packages/connector-clickup/src/testing/index.ts'),
      },
      {
        find: /^@exitos\/connector-clickup$/,
        replacement: src('./packages/connector-clickup/src/index.ts'),
      },
      {
        find: /^@exitos\/demo-workspace$/,
        replacement: src('./examples/demo-workspace/src/index.ts'),
      },
      {
        find: /^@exitos\/example-connector$/,
        replacement: src('./examples/example-connector/src/index.ts'),
      },
      { find: /^@exitos\/cli$/, replacement: src('./apps/cli/src/index.ts') },
    ],
  },
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'apps/*/test/**/*.test.ts',
      'examples/*/test/**/*.test.ts',
    ],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
