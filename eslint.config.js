import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/dist-types/**', '**/coverage/**', '**/.wrangler/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['scripts/**/*.ts', '*.config.{js,ts}', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
);
