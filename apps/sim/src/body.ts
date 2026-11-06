import type { EngineContext, Pose } from './bridge.ts'
import type { Point } from './scene.ts'

// The duck's body under code control: walk to a point and end on a heading, through the engine's waypoint source
// (Spike A's setTarget with the turn-in-place and orbit guard). Falls are the engine's own recovery state machine; a
// fall it recovers from resumes the walk, one that stays down past RECOVERY_MS ends it as `fell`.

const RECOVERY_MS = 15_000
/** Spike A: about 12 s per metre and 9 s per 90° turn; a stall is at most ~1.3 m and two turns away. */
const WALK_TIMEOUT_MS = 90_000
const MAX_RESUMES = 2
const CLOSE_ENOUGH = 0.15

interface WalkResult {
  readonly arrived: boolean
  /** True only when the duck fell and did not get back up. */
  readonly fell: boolean
  readonly recoveredFalls: number
  readonly seconds: number
  readonly distanceToTarget: number
}

export interface Body {
  readonly pose: () => Pose
  readonly walkTo: (target: Point) => Promise<WalkResult>
  readonly stop: () => void
  readonly ready: () => boolean
  readonly fallen: () => boolean
  readonly teleport: (target: Point) => void
  readonly tick: () => void
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export const makeBody = (engine: EngineContext): Body => {
  let falls = 0
  let wasDown = false
  let downSince: number | null = null

  const leg = (target: Point) =>
    new Promise<{ readonly ok: boolean; readonly reason: string }>((resolve) => {
      const timer = setTimeout(() => engine.waypointSource.cancel(), WALK_TIMEOUT_MS)
      engine.waypointSource.setTarget(target.x, target.y, {
        arriveRadius: 0.08,
        faceYaw: target.yaw,
        yawTol: 0.12,
        onDone: (result) => {
          clearTimeout(timer)
          resolve({ ok: result.ok, reason: result.reason ?? 'arrived' })
        },
      })
    })

  /** Waits while the engine's recovery runs; false when the duck is still down after RECOVERY_MS. */
  const recover = async () => {
    const started = performance.now()
    while (engine.getRecovery() !== null || engine.getInputLocked()) {
      if (performance.now() - started > RECOVERY_MS) return false
      await sleep(250)
    }
    return true
  }

  const distanceTo = (target: Point) => {
    const [x, y] = engine.getPose()
    return Math.hypot(target.x - x, target.y - y)
  }

  const walkTo = async (target: Point): Promise<WalkResult> => {
    const started = performance.now()
    const falls0 = falls
    const finish = (arrived: boolean, fell: boolean): WalkResult => ({
      arrived,
      fell,
      recoveredFalls: falls - falls0 - (fell ? 1 : 0),
      seconds: Math.round((performance.now() - started) / 100) / 10,
      distanceToTarget: Math.round(distanceTo(target) * 100) / 100,
    })
    for (let attempt = 0; attempt <= MAX_RESUMES; attempt++) {
      const fallsBefore = falls
      const result = await leg(target)
      // Close enough counts: the QR decodes from anywhere within ~0.15 m of the approach point (Spike A4).
      if (result.ok || distanceTo(target) < CLOSE_ENOUGH) return finish(true, false)
      // A fall cancels the target (manual override by the recovery); resume once the duck is up again.
      if (falls === fallsBefore && engine.getRecovery() === null) return finish(false, false)
      if (!(await recover())) return finish(false, true)
    }
    return finish(false, false)
  }

  return {
    pose: engine.getPose,
    walkTo,
    stop: () => engine.waypointSource.cancel(),
    ready: () => !engine.getInputLocked(),
    fallen: () => downSince !== null && performance.now() - downSince > RECOVERY_MS,
    teleport: (target) => engine.teleport(target.x, target.y, target.yaw),
    tick: () => {
      const down = engine.getRecovery() !== null
      if (down && !wasDown) {
        falls += 1
        downSince = performance.now()
      }
      if (!down) downSince = null
      wasDown = down
    },
  }
}
