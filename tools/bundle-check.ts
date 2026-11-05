import { glob, readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'

let clientGzip = 0
let clientFiles = 0
for await (const file of glob('apps/web/dist/client/assets/*.{js,css}')) {
  clientGzip += gzipSync(await readFile(file)).byteLength
  clientFiles += 1
}
const server = await readFile('apps/web/dist/server/fetch.js')
if (clientFiles === 0) throw new Error('No browser assets found; build before checking budgets')
if (clientGzip > 262144) throw new Error(`Initial browser assets exceed the 256 KiB gzip budget: ${clientGzip}`)
if (server.byteLength > 3145728) throw new Error(`SSR Worker exceeds the 3 MiB source budget: ${server.byteLength}`)
console.log(`Bundle budgets: browser ${clientGzip} gzip bytes; SSR ${server.byteLength} source bytes`)
