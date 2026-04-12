import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'

import { tanstackRouter } from '@tanstack/router-plugin/vite'

import solidPlugin from 'vite-plugin-solid'
import Icons from 'unplugin-icons/vite'

import serverPkg from '../server/package.json'

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(serverPkg.version),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8078/',
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
  ],
})
