import { defineConfig } from 'vitest/config';

// The existing root test config intentionally handles .ts only and preserves
// JSX for Next. Keep email rendering tests separate without changing that file.
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  test: { environment: 'node', include: ['src/emails/**/*.test.tsx'] },
});
