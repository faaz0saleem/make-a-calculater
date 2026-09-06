import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Email templates are React components, so their tests are `.tsx` and need
  // the automatic JSX runtime. One config, so `pnpm test` is the whole suite —
  // a test file that only runs when somebody remembers a second command is a
  // test file that stops running.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
