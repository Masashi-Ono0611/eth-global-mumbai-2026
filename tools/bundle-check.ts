import { glob, readFile, stat } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'

let clientGzip = 0
let clientFiles = 0
for await (const file of glob('apps/web/dist/client/app/assets/*.{js,css}')) {
  clientGzip += gzipSync(await readFile(file)).byteLength
  clientFiles += 1
}
const server = await readFile('apps/web/dist/server/fetch.js')
if (clientFiles === 0) throw new Error('No browser assets found; build before checking budgets')
if (clientGzip > 262144) throw new Error(`Initial browser assets exceed the 256 KiB gzip budget: ${clientGzip}`)
if (server.byteLength > 3145728) throw new Error(`SSR Worker exceeds the 3 MiB source budget: ${server.byteLength}`)
// Workers static assets take at most 25 MiB per file. The simulator (apps/sim, built into apps/web/public/sim and copied
// to the edge's assets) ships MuJoCo's and onnxruntime-web's wasm at ~10 and ~13 MiB; it is a separate page, so it is
// outside the initial-assets budget above.
let largest = { file: '', bytes: 0 }
for await (const file of glob('apps/web/dist/client/**/*')) {
  const { size } = await stat(file)
  if (size > largest.bytes) largest = { file, bytes: size }
}
if (largest.bytes > 25 * 1024 * 1024) throw new Error(`Static asset over the 25 MiB limit: ${largest.file}`)
console.log(
  `Bundle budgets: browser ${clientGzip} gzip bytes; SSR ${server.byteLength} source bytes; largest asset ${largest.bytes} bytes (${largest.file})`,
)
