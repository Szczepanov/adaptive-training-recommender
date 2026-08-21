import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'artifacts/coverage']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // eslint-plugin-react-hooks 7.1 enables this in its recommended preset.
      // Existing effects intentionally load/reset component state, so keep the dependency
      // upgrade separate from a broad application lifecycle refactor.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    // POLICY_VERSION drift protection treats any rules.ts edit as decision-affecting.
    // Keep the engine byte-stable for this lint-only migration instead of creating a false policy bump.
    files: ['src/engine/rules.ts'],
    rules: {
      'no-useless-assignment': 'off',
    },
  },
])
