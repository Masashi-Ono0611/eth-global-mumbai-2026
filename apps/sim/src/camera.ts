import jsQR, { type QRCode } from 'jsqr'
import * as THREE from 'three'
import type { EngineContext } from './bridge.ts'
import { el } from './dom.ts'

// The duck's head ("chip") camera, from Spike A4: a 320×240 PerspectiveCamera on the rig's jaw_soft body at the MJCF
// camera pose, rendered at ~5 Hz into a render target, read back (asynchronously while the duck walks, so the 50 Hz
// policy loop never stalls), decoded with jsQR, and shown in a picture-in-picture panel. Only a JPEG crop of the
// decoded QR ever leaves this module, and only when the nav executor asks for one to sign.

const WIDTH = 320
const HEIGHT = 240
const HZ = 5
const FOVY = 45
/** The Worker caps a scan crop at 512 KiB; the chip's own limit is 64 KiB. */
const MAX_JPEG_BYTES = 64 * 1024

/**
 * `vq1:<invoiceId>` (the short robot-facing form, in either case: the screens show it upper case for QR alphanumeric
 * mode, and invoice ids are lower-case base32) or `http(s)://…/api/i/<invoiceId>`.
 */
const parseInvoicePayload = (text: string): string | null => {
  const trimmed = text.trim()
  const short = /^vq1:([a-z2-7]{26})$/i.exec(trimmed)
  if (short !== null) return short[1]?.toLowerCase() ?? null
  if (!URL.canParse(trimmed)) return null
  const url = new URL(trimmed)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  return /\/api\/i\/([A-Za-z0-9_-]{1,128})\/?$/.exec(url.pathname)?.[1] ?? null
}

interface Sighting {
  readonly invoiceId: string
  readonly capturedAt: number
  /** The QR's bounding box plus a 20% margin, in frame pixels. */
  readonly box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  /** The frame the QR was decoded from (sRGB, top-down), kept for the crop. */
  readonly frame: ImageData
}

export interface HeadCamera {
  /** The latest invoice QR in view, if it was decoded within `maxAgeMs`. */
  readonly sighting: (maxAgeMs: number) => Sighting | null
  /** Resolves with the next sighting decoded after now, or null after `timeoutMs`. */
  readonly nextSighting: (timeoutMs: number) => Promise<Sighting | null>
  /** The chip-signable JPEG crop (starts FF D8 FF, at most 64 KiB). */
  readonly crop: (sighting: Sighting) => Promise<Uint8Array>
  /** The latest whole camera frame as a JPEG (at most 64 KiB) and when it was read back, for the owner's live view;
   *  null before the first frame. Never decision input. */
  readonly snapshot: () => Promise<{ readonly jpeg: Uint8Array; readonly capturedAt: number } | null>
  readonly tick: () => void
}

/** Render targets come out linear (three r164 applies the sRGB transform only to the canvas): encode with a LUT. */
const SRGB = Uint8Array.from({ length: 256 }, (_, i) => {
  const l = i / 255
  return Math.round(255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055))
})

/** GL rows run bottom-up and the target is linear: flip and encode to sRGB. */
const toSrgbFrame = (raw: Uint8Array) => {
  const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4)
  const row = WIDTH * 4
  for (let y = 0; y < HEIGHT; y++) {
    const source = (HEIGHT - 1 - y) * row
    for (let i = 0; i < row; i++) rgba[y * row + i] = (i & 3) === 3 ? 255 : (SRGB[raw[source + i] ?? 0] ?? 0)
  }
  return new ImageData(rgba, WIDTH, HEIGHT)
}

const statusText = (code: QRCode | null, invoiceId: string | null) => {
  if (code === null) return 'searching'
  return invoiceId === null ? 'QR, not an invoice' : `QR ✓ ${invoiceId}`
}

const boxOf = (code: QRCode) => {
  const corners = [
    code.location.topLeftCorner,
    code.location.topRightCorner,
    code.location.bottomLeftCorner,
    code.location.bottomRightCorner,
  ]
  const xs = corners.map((point) => point.x)
  const ys = corners.map((point) => point.y)
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const [mx, my] = [(x1 - x0) * 0.2, (y1 - y0) * 0.2]
  const x = Math.max(0, Math.floor(x0 - mx))
  const y = Math.max(0, Math.floor(y0 - my))
  return { x, y, w: Math.min(WIDTH, Math.ceil(x1 + mx)) - x, h: Math.min(HEIGHT, Math.ceil(y1 + my)) - y }
}

const jpegOf = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob === null ? reject(new Error('JPEG encode failed')) : resolve(blob)),
      'image/jpeg',
      quality,
    ),
  )

const cropJpeg = async (sighting: Sighting) => {
  const full = document.createElement('canvas')
  full.width = WIDTH
  full.height = HEIGHT
  full.getContext('2d')?.putImageData(sighting.frame, 0, 0)
  const crop = document.createElement('canvas')
  crop.width = sighting.box.w
  crop.height = sighting.box.h
  crop
    .getContext('2d')
    ?.drawImage(full, sighting.box.x, sighting.box.y, crop.width, crop.height, 0, 0, crop.width, crop.height)
  for (let quality = 0.9; quality > 0.25; quality -= 0.1) {
    const bytes = new Uint8Array(await (await jpegOf(crop, quality)).arrayBuffer())
    if (bytes.byteLength > MAX_JPEG_BYTES) continue
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new Error('crop is not a JPEG')
    return bytes
  }
  throw new Error('crop does not fit 64 KiB')
}

/** A whole frame as a JPEG under the frame limit: the highest of a few qualities that fits. */
const frameJpeg = async (frame: ImageData) => {
  const canvas = document.createElement('canvas')
  canvas.width = frame.width
  canvas.height = frame.height
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('2D canvas unavailable')
  context.putImageData(frame, 0, 0)
  for (const quality of [0.7, 0.5, 0.3]) {
    const bytes = new Uint8Array(await (await jpegOf(canvas, quality)).arrayBuffer())
    if (bytes.byteLength <= MAX_JPEG_BYTES) return bytes
  }
  throw new Error('frame does not fit in 64 KiB')
}

/** The camera on jaw_soft, rolled so image-up is world-up (Spike A's fix for the kinematics export's frame). */
const mountCamera = (engine: EngineContext) => {
  const camera = new THREE.PerspectiveCamera(FOVY, WIDTH / HEIGHT, 0.01, 6)
  // MJCF quat "0 0 -1 0" (wxyz) as three's xyzw, post-multiplied by microduck_rl's flip [0,1,0,0] (wxyz).
  const base = new THREE.Quaternion(0, -1, 0, 0).multiply(new THREE.Quaternion(1, 0, 0, 0))
  camera.quaternion.copy(base)
  camera.position.set(0.0155, -9.13778e-5, -0.0733)
  const axis = new THREE.Vector3(0, 0, 1)
  const rollTo = (roll: number) =>
    camera.quaternion.copy(base).multiply(new THREE.Quaternion().setFromAxisAngle(axis, roll))
  let parent: THREE.Object3D | null = null
  let rolled = false
  return {
    camera,
    attach: () => {
      const jaw = engine.getRig()?.bodies.get('jaw_soft')
      if (jaw === undefined) return
      if (parent !== jaw) {
        jaw.add(camera)
        parent = jaw
      }
      if (rolled || engine.getInputLocked()) return
      const upY = (roll: number) => {
        rollTo(roll)
        camera.updateWorldMatrix(true, false)
        return new THREE.Vector3(0, 1, 0).transformDirection(camera.matrixWorld).y
      }
      const rolls = [0, Math.PI / 2, -Math.PI / 2, Math.PI]
      rollTo(rolls.reduce((best, roll) => (upY(roll) > upY(best) ? roll : best), 0))
      rolled = true
    },
  }
}

const makePanel = () => {
  const frame = el('canvas', 'block h-[180px] w-[240px] [image-rendering:pixelated]')
  frame.width = WIDTH
  frame.height = HEIGHT
  const status = el('p', 'font-mono text-[11px] text-white/70', ['searching'])
  const panel = el(
    'figure',
    'pointer-events-none fixed top-20 right-3 z-50 grid gap-1 rounded-lg bg-black/75 p-2 ring-1 ring-amber-400/60',
    [
      el('figcaption', 'font-mono text-[11px] font-semibold tracking-wide text-amber-300 uppercase', [
        `Chip camera · ${WIDTH}×${HEIGHT} · ${HZ} Hz`,
      ]),
      frame,
      status,
    ],
  )
  document.body.appendChild(panel)
  const context = frame.getContext('2d')
  if (context === null) throw new Error('2D canvas unavailable')
  return { context, status }
}

export const makeHeadCamera = (engine: EngineContext): HeadCamera => {
  const { camera, attach } = mountCamera(engine)
  const { renderer, scene } = engine
  const target = new THREE.WebGLRenderTarget(WIDTH, HEIGHT, { depthBuffer: true })
  const raw = new Uint8Array(WIDTH * HEIGHT * 4)
  const panel = makePanel()
  const readback = makeReadback(renderer, raw)
  let latest: Sighting | null = null
  let lastFrame: { readonly frame: ImageData; readonly capturedAt: number } | null = null
  let lastFrameAt = 0
  const waiters = new Set<(sighting: Sighting) => void>()

  const render = () => {
    attach()
    const previous = renderer.getRenderTarget()
    renderer.setRenderTarget(target)
    renderer.clear()
    renderer.render(scene, camera)
    renderer.setRenderTarget(previous)
  }

  const process = () => {
    const frame = toSrgbFrame(raw)
    lastFrame = { frame, capturedAt: Date.now() }
    const code = jsQR(frame.data, WIDTH, HEIGHT, { inversionAttempts: 'dontInvert' })
    panel.context.putImageData(frame, 0, 0)
    const invoiceId = code === null ? null : parseInvoicePayload(code.data)
    panel.status.textContent = statusText(code, invoiceId)
    if (code === null) return
    const box = boxOf(code)
    panel.context.strokeStyle = invoiceId === null ? '#ff0' : '#0f0'
    panel.context.lineWidth = 2
    panel.context.strokeRect(box.x, box.y, box.w, box.h)
    if (invoiceId === null) return
    const sighting: Sighting = { invoiceId, capturedAt: Date.now(), box, frame }
    latest = sighting
    for (const notify of waiters) notify(sighting)
    waiters.clear()
  }

  return {
    sighting: (maxAgeMs) => (latest !== null && Date.now() - latest.capturedAt <= maxAgeMs ? latest : null),
    nextSighting: (timeoutMs) =>
      new Promise((resolve) => {
        const done = (sighting: Sighting | null) => {
          clearTimeout(timer)
          waiters.delete(done)
          resolve(sighting)
        }
        const timer = setTimeout(() => done(null), timeoutMs)
        waiters.add(done)
      }),
    crop: cropJpeg,
    snapshot: async () => {
      const shot = lastFrame
      return shot === null ? null : { jpeg: await frameJpeg(shot.frame), capturedAt: shot.capturedAt }
    },
    tick: () => {
      if (readback.poll()) process()
      const now = performance.now()
      if (now - lastFrameAt < 1000 / HZ || readback.busy()) return
      lastFrameAt = now
      render()
      // Spike A: async while the duck walks (smooth gait), sync while it stands (a stall is invisible then).
      if (engine.waypointSource.isActive()) readback.start(target)
      else {
        readback.sync(target)
        process()
      }
    },
  }
}

/** WebGL2 pixel-pack buffer plus fence: the read completes without blocking the main thread. */
const makeReadback = (renderer: THREE.WebGLRenderer, into: Uint8Array) => {
  const gl = renderer.getContext()
  const webgl2 = gl instanceof WebGL2RenderingContext ? gl : null
  const buffer = webgl2?.createBuffer() ?? null
  if (webgl2 !== null && buffer !== null) {
    webgl2.bindBuffer(webgl2.PIXEL_PACK_BUFFER, buffer)
    webgl2.bufferData(webgl2.PIXEL_PACK_BUFFER, into.byteLength, webgl2.STREAM_READ)
    webgl2.bindBuffer(webgl2.PIXEL_PACK_BUFFER, null)
  }
  let fence: WebGLSync | null = null
  const sync = (target: THREE.WebGLRenderTarget) => renderer.readRenderTargetPixels(target, 0, 0, WIDTH, HEIGHT, into)
  return {
    busy: () => fence !== null,
    sync,
    start: (target: THREE.WebGLRenderTarget) => {
      if (webgl2 === null || buffer === null) return sync(target)
      const previous = renderer.getRenderTarget()
      renderer.setRenderTarget(target)
      webgl2.bindBuffer(webgl2.PIXEL_PACK_BUFFER, buffer)
      webgl2.readPixels(0, 0, WIDTH, HEIGHT, webgl2.RGBA, webgl2.UNSIGNED_BYTE, 0)
      webgl2.bindBuffer(webgl2.PIXEL_PACK_BUFFER, null)
      fence = webgl2.fenceSync(webgl2.SYNC_GPU_COMMANDS_COMPLETE, 0)
      webgl2.flush()
      renderer.setRenderTarget(previous)
    },
    /** True when an async read has just landed in `into`. */
    poll: () => {
      if (webgl2 === null || buffer === null || fence === null) return false
      if (webgl2.clientWaitSync(fence, 0, 0) === webgl2.TIMEOUT_EXPIRED) return false
      webgl2.deleteSync(fence)
      fence = null
      webgl2.bindBuffer(webgl2.PIXEL_PACK_BUFFER, buffer)
      webgl2.getBufferSubData(webgl2.PIXEL_PACK_BUFFER, 0, into)
      webgl2.bindBuffer(webgl2.PIXEL_PACK_BUFFER, null)
      return true
    },
  }
}
