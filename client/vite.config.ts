import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'

import { tanstackRouter } from '@tanstack/router-plugin/vite'

import solidPlugin from 'vite-plugin-solid'
import Icons from 'unplugin-icons/vite'
import { VitePWA } from 'vite-plugin-pwa'

import serverPkg from '../server/package.json'

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(serverPkg.version),
  },
  build: {
    outDir: '../server/client/dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8078/',
      '/uploads': 'http://localhost:8078/',
      '/trpc': 'http://localhost:8078/',
    },
  },
  plugins: [

    devtools(),
    // this is the plugin that enables path aliases
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tailwindcss(),
    tanstackRouter({ target: 'solid', autoCodeSplitting: true }),
    solidPlugin(),
    Icons({ compiler: 'solid' }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'logo192.png', 'logo512.png', 'robots.txt'],
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/trpc/, /^\/uploads/, /^\/socket\.io/],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        enabled: false,
      },
      manifest: {
        id: '/',
        name: 'freedungeon',
        short_name: 'freedungeon',
        description: 'A roleplaying experience with an LLM dungeon master.',
        lang: 'en',
        dir: 'ltr',
        categories: ['games', 'entertainment'],
        start_url: '/',
        scope: '/',
        display: 'standalone',
        display_override: ['standalone'],
        orientation: 'any',
        theme_color: '#0a0a0f',
        background_color: '#0a0a0f',
        prefer_related_applications: false,
        icons: [
          {
            src: 'favicon.ico',
            sizes: '64x64 32x32 24x24 16x16',
            type: 'image/x-icon',
          },
          {
            src: 'logo192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'logo512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
        ],
      },
    }),
  ],
})
