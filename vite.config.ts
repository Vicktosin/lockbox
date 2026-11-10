import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // The companion extension and staged releases have their own HTML entry points.
  optimizeDeps: { entries: ['index.html'] },
  server: {
    host: '127.0.0.1',
    watch: { ignored: ['**/server/**', '**/.codex/**', '**/.agents/**'] },
    fs: {
      deny: [
        '.env',
        '.env.*',
        '*.{crt,pem,key,p12,pfx,cer,der}',
        '.npmrc',
        '.yarnrc.yml',
        '**/.git/**',
        '**/server/**',
        '**/.codex/**',
        '**/.agents/**',
        '**/*.{sqlite,sqlite-wal,sqlite-shm,lbx,lbbak}',
      ],
    },
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Registration and the update experience will be added in the PWA phase.
      injectRegister: false,
      manifest: {
        id: '/',
        name: 'LOCKBOX',
        short_name: 'LOCKBOX',
        description: 'A private password manager for a household of two.',
        theme_color: '#286951',
        background_color: '#f8faf9',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
})
