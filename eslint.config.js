import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'tools/engine.bundle.js'] },
  {
    files: ['mockups/*.mjs', 'tools/**/*.mjs'],
    languageOptions: {
      globals: {
        URL: 'readonly',
        console: 'readonly',
        process: 'readonly',
        TextEncoder: 'readonly',
      },
    },
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
);
