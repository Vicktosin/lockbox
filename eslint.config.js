import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'extension/dist/**',
      'releases/**',
      'node_modules/**',
      'server/.data/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}', 'shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['**/server/**', '@server/**'] },
      ],
    },
  },
  { files: ['scripts/**/*.mjs'], languageOptions: { globals: globals.node } },
  {
    files: ['extension/**/*.mjs'],
    languageOptions: { globals: { ...globals.browser, chrome: 'readonly' } },
  },
  prettier,
)
