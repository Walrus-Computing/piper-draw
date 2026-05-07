import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// Files allowed to exceed max-lines (>600 LOC). The 6 "hot files" from the
// CEO plan 2026-04-30-tech-debt-context-reduction.md.
// REMOVE the override here in the SAME PR that takes the file under threshold (decision 2B=B).
const GRANDFATHERED_MAX_LINES = [
  'src/stores/blockStore.ts',
  'src/types/index.ts',
  'src/components/Toolbar.tsx',
  'src/App.tsx',
  'src/components/ZXPanel.tsx',
  'src/components/FlowsPanel.tsx',
]

// Files containing functions over 80 lines at the time max-lines-per-function
// was introduced. Same removal policy as above.
const GRANDFATHERED_MAX_LINES_PER_FUNCTION = [
  ...GRANDFATHERED_MAX_LINES,
  'src/components/BlockInstances.tsx',
  'src/components/GhostBlock.tsx',
  'src/components/GridPlane.tsx',
  'src/components/HelpPanel.tsx',
  'src/components/KeybindEditor.tsx',
  'src/components/OpenPipeGhosts.tsx',
  'src/components/PortsTable.tsx',
  'src/components/PreviewRenderer.tsx',
  'src/components/SelectModePointer.tsx',
  'src/components/ValidationToast.tsx',
  'src/hooks/useFloatingPanel.ts',
  'src/stores/validationStore.ts',
  'src/utils/daeExport.ts',
  'src/utils/daeImport.ts',
]

export default defineConfig([
  globalIgnores(['dist']),
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
      'max-lines': ['error', { max: 600, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true, IIFEs: true }],
    },
  },
  {
    files: GRANDFATHERED_MAX_LINES,
    rules: { 'max-lines': 'off' },
  },
  {
    files: GRANDFATHERED_MAX_LINES_PER_FUNCTION,
    rules: { 'max-lines-per-function': 'off' },
  },
  {
    files: ['**/*.test.{ts,tsx}', '**/__tests__/**/*.{ts,tsx}'],
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': 'off',
    },
  },
])
