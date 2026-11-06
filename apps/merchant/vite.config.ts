import { foldkit } from '@foldkit/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// A client-only Foldkit app (repos/foldkit/examples/counter), styled like apps/web: Tailwind first, then Foldkit.
export default defineConfig({ plugins: [tailwindcss(), foldkit()] })
