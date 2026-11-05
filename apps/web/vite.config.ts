import { foldkit } from '@foldkit/vite-plugin'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [foldkit({ ssr: { serverEntry: '/src/entry.server.ts', clientEntry: '/src/entry.ts', build: true } })],
})
