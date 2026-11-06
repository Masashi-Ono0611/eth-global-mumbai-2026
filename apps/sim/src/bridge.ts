import type { Camera, Object3D, Scene, WebGLRenderer } from 'three'
import { type Body, makeBody } from './body.ts'
import { makeHeadCamera, type HeadCamera } from './camera.ts'
import { buildCafe, type Cafe, stallColliders } from './scene.ts'

// The seam between Pollen's vendored engine (vendor/microduck, JavaScript) and our code. The engine calls
// `vqBridge.colliders()` while it builds the MJCF and `vqBridge.install(context)` once the duck is up; everything we
// need from the engine arrives through `EngineContext`, so our code never imports the vendored modules.

/** Pollen's waypoint source with Spike A's programmatic targets (vendor/microduck/src/game/controls/waypoint.js). */
interface WaypointResult {
  readonly ok: boolean
  readonly reason?: string
  readonly settled?: boolean
}
interface TargetOptions {
  readonly arriveRadius?: number
  readonly faceYaw?: number | null
  readonly yawTol?: number
  readonly onDone?: (result: WaypointResult) => void
}
interface WaypointSource {
  setTarget(x: number, y: number, options?: TargetOptions): void
  faceYaw(yaw: number, options?: Omit<TargetOptions, 'arriveRadius' | 'faceYaw'>): void
  cancel(): void
  isActive(): boolean
}

interface Rig {
  readonly bodies: ReadonlyMap<string, Object3D>
}

/** MJCF ground pose: x, y (metres) and yaw (radians, counter-clockwise from +x). */
export type Pose = readonly [x: number, y: number, yaw: number]

export interface EngineContext {
  readonly scene: Scene
  readonly renderer: WebGLRenderer
  readonly camera: Camera
  readonly getRig: () => Rig | null | undefined
  readonly getPose: () => Pose
  readonly waypointSource: WaypointSource
  /** The engine's fall-recovery state machine: null while the duck is upright. */
  readonly getRecovery: () => 'fallen' | 'recovering' | null
  readonly getCtrlHz: () => number
  readonly getSimTime: () => number
  /** True while the entrance ceremony or a respawn holds the controls. */
  readonly getInputLocked: () => boolean
  readonly teleport: (x: number, y: number, yaw?: number) => void
}

/** What our code drives once the engine is up. */
export interface SimWorld {
  readonly engine: EngineContext
  readonly cafe: Cafe
  readonly body: Body
  readonly camera: HeadCamera
}

let world: SimWorld | undefined
const waiting = new Set<(world: SimWorld) => void>()

export const vqBridge = {
  colliders: stallColliders,
  install: (engine: EngineContext) => {
    const cafe = buildCafe(engine.scene)
    const body = makeBody(engine)
    const camera = makeHeadCamera(engine)
    const ready: SimWorld = { engine, cafe, body, camera }
    world = ready
    for (const notify of waiting) notify(ready)
    waiting.clear()
    return {
      tick: (dt: number) => {
        cafe.tick(dt)
        body.tick()
        camera.tick()
      },
    }
  },
  /** Resolves once the engine has booted and installed the café. */
  ready: (): Promise<SimWorld> =>
    world === undefined ? new Promise((resolve) => waiting.add(resolve)) : Promise.resolve(world),
}
