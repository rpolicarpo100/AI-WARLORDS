import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
  {
    files: ['mockups/*.mjs', 'tools/*.mjs'],
    languageOptions: { globals: { URL: 'readonly', console: 'readonly' } },
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
);
