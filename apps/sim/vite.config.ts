import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// `bun run dev` serves the page alone; set SIM_API to an app origin (a deployed stage) to proxy /api to it. Owner
// routes then need that origin's session cookie, which a proxied page cannot have: use it for the chip side only.
const api = process.env.SIM_API

// The simulator page, served by the app's edge Worker as static assets under /sim/ (same origin as the API, so the
// owner's session cookie and the chip's routes need no CORS). The build lands in apps/web/public/sim (git-ignored), so
// every apps/web build, including the one Alchemy reruns on deploy, copies it into the edge's asset directory.
// MuJoCo and onnxruntime-web are single-threaded builds: no COOP/COEP needed (Spike A).
export default defineConfig({
  base: '/sim/',
  plugins: [tailwindcss(), react()],
  server: {
    host: '127.0.0.1',
    port: 5791,
    strictPort: true,
    allowedHosts: ['netcup.tail5acf67.ts.net'],
    ...(api === undefined ? {} : { proxy: { '/api': { target: api, changeOrigin: true } } }),
  },
  build: {
    outDir: '../web/public/sim',
    emptyOutDir: true,
    assetsDir: 'bundle',
    chunkSizeWarningLimit: 1500,
  },
})
