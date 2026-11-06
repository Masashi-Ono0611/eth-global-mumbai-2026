import { NavPlace } from '@ethmumbai/protocol/Intent'
import * as THREE from 'three'
import { encode } from 'uqr'

// The Duck Café hall, in MJCF ground coordinates (x, y, z up; three.js is x, z, -y). Three stalls stand in a row facing
// the entrance, one per catalogue item, each with an MJCF box collider, a counter mesh, a 0.14 m invoice screen 0.20 m
// up, a name-and-price label and a gate arm that opens when that stall's invoice is paid. The exit gate is the
// `gate` place. Spike A measured the duck at 0.11 m/s and ~9 s per 90° turn, so everything is within ~1 m.

export type StallId = 'chai' | 'samosa' | 'thali'

interface StallDef {
  readonly id: StallId
  readonly place: NavPlace
  readonly name: string
  /** USDC, as the catalogue prices it (packages/server/src/merchant/Catalogue.ts). */
  readonly price: string
  readonly y: number
  readonly color: number
}

const STALL_X = 0.6
const COUNTER_DEPTH = 0.16
const COUNTER_WIDTH = 0.34
const COUNTER_H = 0.12
const SCREEN_SIZE = 0.14
const SCREEN_CENTER_H = 0.2
/** Approach points stand this far in front of a counter: the camera is then 0.22-0.3 m from the screen (Spike A4). */
const APPROACH_DIST = 0.3
/** Every stall faces -x, towards the entrance. */
const STALL_FACE = Math.PI

const STALLS: ReadonlyArray<StallDef> = [
  { id: 'chai', place: 'chai_stall', name: 'Chai', price: '0.10', y: 0.5, color: 0xc8743a },
  { id: 'samosa', place: 'samosa_stall', name: 'Samosa', price: '0.25', y: 0, color: 0xd4a017 },
  { id: 'thali', place: 'thali_stall', name: 'Thali', price: '2.00', y: -0.5, color: 0x3a8c6c },
]

export interface Point {
  readonly x: number
  readonly y: number
  /** The heading the duck should end with at this point. */
  readonly yaw: number
  /**
   * Where to line up first: a point straight back along `yaw`, so the last leg is a run-in that arrives already facing.
   * The walking policy cannot turn in place (6 Nov e2e run), and an arc cannot reach a point inside its turning circle.
   */
  readonly via?: { readonly x: number; readonly y: number }
}

export const ENTRANCE: Point = { x: -0.55, y: 0, yaw: 0 }
const EXIT_GATE = { x: -0.15, y: -0.95 }
const EXIT_APPROACH: Point = { x: -0.15, y: -0.62, yaw: -Math.PI / 2 }

/** How far behind a stall's approach point its line-up point is: room for a U-turn arc (radius ~0.17 m) and a run-in. */
const LINE_UP_DIST = 0.7

const approachOf = (def: StallDef): Point => {
  const out = COUNTER_DEPTH / 2 + APPROACH_DIST
  return {
    x: STALL_X + Math.cos(STALL_FACE) * out,
    y: def.y + Math.sin(STALL_FACE) * out,
    yaw: STALL_FACE - Math.PI,
    via: {
      x: STALL_X + Math.cos(STALL_FACE) * (out + LINE_UP_DIST),
      y: def.y + Math.sin(STALL_FACE) * (out + LINE_UP_DIST),
    },
  }
}

/** The MJCF boxes the engine appends to its worldbody (the counters are solid; screens and gates are not). */
export const stallColliders = () =>
  STALLS.map((def) => ({
    name: `vq_counter_${def.id}`,
    pos: `${STALL_X} ${def.y} ${COUNTER_H / 2}`,
    size: `${COUNTER_DEPTH / 2} ${COUNTER_WIDTH / 2} ${COUNTER_H / 2}`,
    euler: `0 0 ${STALL_FACE}`,
  }))

const material = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.7 })
const unlit = (map: THREE.Texture) => new THREE.MeshBasicMaterial({ map, toneMapped: false })

const canvasTexture = (canvas: HTMLCanvasElement) => {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

const context2d = (canvas: HTMLCanvasElement) => {
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('2D canvas unavailable')
  return context
}

const labelTexture = (lines: ReadonlyArray<string>, color: number) => {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const g = context2d(canvas)
  g.fillStyle = `#${color.toString(16).padStart(6, '0')}`
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.fillStyle = '#fff'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = 'bold 50px system-ui, sans-serif'
  g.fillText(lines[0] ?? '', canvas.width / 2, 42)
  g.font = '36px system-ui, sans-serif'
  g.fillText(lines[1] ?? '', canvas.width / 2, 96)
  return canvasTexture(canvas)
}

/** One screen state: a payment QR (`vq1:<invoiceId>`), or a caption on a dark or green ground. */
type ScreenContent =
  | { readonly kind: 'qr'; readonly payload: string }
  | { readonly kind: 'text'; readonly text: string; readonly tone: 'idle' | 'paid' }

const drawScreen = (canvas: HTMLCanvasElement, content: ScreenContent) => {
  const g = context2d(canvas)
  if (content.kind === 'text') {
    canvas.width = canvas.height = 256
    g.fillStyle = content.tone === 'paid' ? '#1f8a4c' : '#223'
    g.fillRect(0, 0, 256, 256)
    g.fillStyle = content.tone === 'paid' ? '#fff' : '#99a'
    g.font = '30px system-ui, sans-serif'
    g.textAlign = 'center'
    g.fillText(content.text, 128, 138)
    return
  }
  // Error correction M with a two-module quiet zone, the same encoder as the wallet (apps/web/src/Qr.ts).
  const qr = encode(content.payload, { ecc: 'M', border: 2 })
  const px = Math.floor(512 / qr.size)
  canvas.width = canvas.height = px * qr.size
  g.fillStyle = '#fff'
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.fillStyle = '#000'
  qr.data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) g.fillRect(x * px, y * px, px, px)
    }),
  )
}

interface GateArm {
  readonly group: THREE.Group
  open: boolean
  tick(dt: number): void
}

const makeGateArm = (length: number): GateArm => {
  const group = new THREE.Group()
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.14), material(0x333333))
  post.position.y = 0.07
  const pivot = new THREE.Group()
  pivot.position.y = 0.13
  const armMaterial = new THREE.MeshBasicMaterial({ color: 0xd03030, toneMapped: false })
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, length), armMaterial)
  arm.position.z = length / 2
  pivot.add(arm)
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.014), armMaterial)
  lamp.position.y = 0.15
  group.add(post, pivot, lamp)
  let lift = 0
  const gate: GateArm = {
    group,
    open: false,
    tick: (dt) => {
      const target = gate.open ? 1 : 0
      lift += Math.max(-dt * 3, Math.min(dt * 3, target - lift))
      pivot.rotation.x = -lift * (Math.PI / 2) * 0.95
      armMaterial.color.setHex(gate.open ? 0x30d050 : 0xd03030)
    },
  }
  return gate
}

export interface Stall {
  readonly id: StallId
  readonly place: NavPlace
  readonly name: string
  readonly price: string
  readonly approach: Point
  /** What the screen shows now (the camera only ever sees pixels; this is for `look`). */
  readonly screen: () => ScreenContent
  readonly setScreen: (content: ScreenContent) => void
  readonly gate: GateArm
}

const buildStall = (scene: THREE.Scene, def: StallDef): Stall => {
  const group = new THREE.Group()
  group.name = `vq_counter_${def.id}`
  group.position.set(STALL_X, 0, -def.y)
  group.rotation.y = STALL_FACE // local +x is the facing direction
  const counter = new THREE.Mesh(new THREE.BoxGeometry(COUNTER_DEPTH, COUNTER_H, COUNTER_WIDTH), material(def.color))
  counter.position.y = COUNTER_H / 2
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.012, SCREEN_SIZE + 0.02, SCREEN_SIZE + 0.02), material(0x111111))
  bezel.position.set(0, SCREEN_CENTER_H, 0)
  const stand = new THREE.Mesh(new THREE.BoxGeometry(0.01, SCREEN_CENTER_H - COUNTER_H, 0.03), material(0x111111))
  stand.position.set(0, (SCREEN_CENTER_H + COUNTER_H) / 2 - SCREEN_SIZE / 4, 0)
  const canvas = document.createElement('canvas')
  const texture = canvasTexture(canvas)
  // Nearest for magnification keeps module edges sharp in the head camera; mipmaps for minification.
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_SIZE, SCREEN_SIZE), unlit(texture))
  screen.rotation.y = Math.PI / 2
  screen.position.set(0.0065, SCREEN_CENTER_H, 0)
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.075),
    unlit(labelTexture([def.name, `${def.price} USDC`], def.color)),
  )
  label.rotation.y = Math.PI / 2
  label.position.set(0, SCREEN_CENTER_H + SCREEN_SIZE / 2 + 0.06, 0)
  const gate = makeGateArm(0.22)
  gate.group.position.set(0.1, 0, COUNTER_WIDTH / 2 + 0.03)
  group.add(counter, bezel, stand, screen, label, gate.group)
  scene.add(group)
  let content: ScreenContent = { kind: 'text', text: 'starting…', tone: 'idle' }
  const setScreen = (next: ScreenContent) => {
    content = next
    drawScreen(canvas, next)
    // The canvas may change size between a QR and a caption: a new upload is needed, not just an update.
    texture.dispose()
    texture.needsUpdate = true
  }
  setScreen(content)
  return { ...def, approach: approachOf(def), screen: () => content, setScreen, gate }
}

const floorSign = (scene: THREE.Scene, text: string, at: { x: number; y: number }, yaw: number) => {
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.08), unlit(labelTexture([text, ''], 0x444455)))
  sign.rotation.set(-Math.PI / 2, 0, yaw - Math.PI / 2)
  sign.position.set(at.x, 0.002, -at.y)
  scene.add(sign)
}

export interface Cafe {
  readonly stalls: ReadonlyArray<Stall>
  readonly exitGate: GateArm
  /** Where each place's approach point is and which way the duck faces there. */
  readonly places: Readonly<Record<NavPlace, Point>>
  readonly stall: (id: StallId) => Stall
  /** The place whose point the duck is standing at (within 0.2 m), if any. */
  readonly placeAt: (x: number, y: number) => NavPlace | null
  readonly tick: (dt: number) => void
}

export const buildCafe = (scene: THREE.Scene): Cafe => {
  const stalls = STALLS.map((def) => buildStall(scene, def))
  const exitGate = makeGateArm(0.3)
  exitGate.group.position.set(EXIT_GATE.x - 0.15, 0, -EXIT_GATE.y)
  exitGate.group.rotation.y = Math.PI / 2
  scene.add(exitGate.group)
  floorSign(scene, 'Entrance', { x: ENTRANCE.x - 0.12, y: ENTRANCE.y }, 0)
  floorSign(scene, 'Exit gate', { x: EXIT_GATE.x, y: EXIT_GATE.y - 0.12 }, Math.PI / 2)
  const [chai, samosa, thali] = stalls
  if (chai === undefined || samosa === undefined || thali === undefined) throw new Error('three stalls expected')
  const places: Record<NavPlace, Point> = {
    entrance: ENTRANCE,
    chai_stall: chai.approach,
    samosa_stall: samosa.approach,
    thali_stall: thali.approach,
    gate: EXIT_APPROACH,
  }
  return {
    stalls,
    exitGate,
    places,
    stall: (id) => {
      const found = stalls.find((stall) => stall.id === id)
      if (found === undefined) throw new Error(`unknown stall ${id}`)
      return found
    },
    placeAt: (x, y) =>
      NavPlace.literals.find((place) => Math.hypot(places[place].x - x, places[place].y - y) < 0.2) ?? null,
    tick: (dt) => {
      for (const stall of stalls) stall.gate.tick(dt)
      exitGate.tick(dt)
    },
  }
}
