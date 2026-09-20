import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { globalIgnores } from 'eslint/config'

export default tseslint.config([
  globalIgnores(['dist', 'src/api/schema.d.ts']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
  },
  {
    // Law 2 enforcement: no score arithmetic in the client, ever.
    // src/scoring/** renders score responses verbatim; it may not compute.
    files: ['src/scoring/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: "BinaryExpression[operator='+']", message: 'No arithmetic in scoring code — render server values verbatim (CLAUDE.md law 2).' },
        { selector: "BinaryExpression[operator='-']", message: 'No arithmetic in scoring code — render server values verbatim (CLAUDE.md law 2).' },
        { selector: "BinaryExpression[operator='*']", message: 'No arithmetic in scoring code — render server values verbatim (CLAUDE.md law 2).' },
        { selector: "BinaryExpression[operator='/']", message: 'No arithmetic in scoring code — render server values verbatim (CLAUDE.md law 2).' },
        { selector: "BinaryExpression[operator='%']", message: 'No arithmetic in scoring code — render server values verbatim (CLAUDE.md law 2).' },
        { selector: "BinaryExpression[operator='**']", message: 'No arithmetic in scoring code — render server values verbatim (CLAUDE.md law 2).' },
        { selector: "UpdateExpression[operator='++']", message: 'No arithmetic in scoring code — render server values verbatim (CLAUDE.md law 2).' },
        { selector: "UpdateExpression[operator='--']", message: 'No arithmetic in scoring code — render server values verbatim (CLAUDE.md law 2).' },
      ],
    },
  },
])
