import { defineConfig, globalIgnores } from 'eslint/config';

const eslintConfig = defineConfig([
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'dist/**',
    // Cloud Functions is a separate package with its own build — root tsc excludes it.
    'functions/**',
    // Dead legacy intro code, kept for reference only — not shipped.
    'legacy/**',
  ]),
]);

export default eslintConfig;
