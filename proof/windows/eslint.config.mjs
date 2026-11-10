import root from '../../eslint.config.js'
import globals from 'globals'
export default [
  ...root,
  { files: ['**/*.{mjs,cjs}'], languageOptions: { globals: globals.node } },
]
