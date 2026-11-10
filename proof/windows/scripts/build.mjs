import { build } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { resolve, dirname, join } from 'node:path'
import {
  mkdirSync,
  copyFileSync,
  cpSync,
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs'
import { validateConfiguration } from '../native/oauth.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..'),
  proof = join(root, 'proof/windows'),
  out = join(root, 'releases/native-proof-build')
if (
  !out.startsWith(join(root, 'releases') + '/') &&
  !out.startsWith(join(root, 'releases') + '\\')
)
  throw new Error('Unsafe output')
await build({
  configFile: false,
  root: join(proof, 'renderer'),
  base: './',
  publicDir: false,
  resolve: { alias: { '@': join(root, 'src') } },
  plugins: [react(), tailwind()],
  build: { outDir: join(out, 'renderer'), emptyOutDir: true },
})
await build({
  configFile: false,
  publicDir: false,
  ssr: { noExternal: true, external: ['electron', 'libsodium-wrappers-sumo'] },
  build: {
    ssr: join(proof, 'native/main.mjs'),
    target: 'node24',
    outDir: join(out, 'main'),
    emptyOutDir: true,
    rolldownOptions: { output: { entryFileNames: 'main.mjs' } },
  },
})
copyFileSync(join(proof, 'native/preload.cjs'), join(out, 'main/preload.cjs'))
mkdirSync(join(out, 'node_modules'), { recursive: true })
for (const name of ['libsodium-sumo', 'libsodium-wrappers-sumo'])
  cpSync(join(proof, 'node_modules', name), join(out, 'node_modules', name), {
    recursive: true,
  })
const publicConfig = join(out, 'public-config.json')
if (existsSync(join(proof, 'native-config.json'))) {
  const configuration = validateConfiguration(
    JSON.parse(readFileSync(join(proof, 'native-config.json'), 'utf8')),
  )
  writeFileSync(publicConfig, JSON.stringify(configuration) + '\n')
} else if (existsSync(publicConfig)) unlinkSync(publicConfig)
console.log(
  'Isolated fictional proof built; existing dist and application configuration were not changed.',
)
