import { foldkit } from '@foldkit/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// Foldkit's own setup (create-foldkit-app, repos/foldkit/examples/ssr): Tailwind first, then Foldkit.
export default defineConfig({
  plugins: [
    tailwindcss(),
    foldkit({ ssr: { serverEntry: '/src/entry.server.ts', clientEntry: '/src/entry.ts', build: true } }),
  ],
})
