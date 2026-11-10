import { build } from 'vite'
import { copyFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
const output = resolve('extension/dist')
await build({
  configFile: false,
  publicDir: false,
  build: {
    outDir: output,
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: {
        background: resolve('extension/background.mjs'),
        popup: resolve('extension/popup.mjs'),
      },
      formats: ['es'],
      fileName: (_format, name) => name + '.js',
    },
  },
})
mkdirSync(output, { recursive: true })
for (const file of ['manifest.json', 'popup.html', 'popup.css'])
  copyFileSync(join('extension', file), join(output, file))
console.log(
  'Candidate only: extension/dist. Not included in the household release; manual Chrome approval-flow and independent security review remain required.',
)
