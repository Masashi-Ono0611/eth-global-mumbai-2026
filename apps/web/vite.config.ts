import { foldkit } from '@foldkit/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// Foldkit's own setup (create-foldkit-app, repos/foldkit/examples/ssr): Tailwind first, then Foldkit.
export default defineConfig({
  // The app lives under /app on vitaquack.com ("/" is the landing page), so its bundles do too: /app/assets/*.
  build: { assetsDir: 'app/assets' },
  plugins: [
    tailwindcss(),
    foldkit({ ssr: { serverEntry: '/src/entry.server.ts', clientEntry: '/src/entry.ts', build: true } }),
  ],
})
