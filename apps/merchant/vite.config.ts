import { foldkit } from '@foldkit/vite-plugin'
import { defineConfig } from 'vite'

// A client-only Foldkit app (repos/foldkit/examples/counter); plain CSS, so it depends on no styling library.
export default defineConfig({ plugins: [foldkit()] })
