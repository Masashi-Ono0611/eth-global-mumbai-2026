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
/** Spike A4 decoded the QR up to 40° off-axis within 0.42 m; ±9° keeps the screen well inside the camera's view. */
const FACE_TOLERANCE = 0.15
/** Lined up: on the approach line (sideways ≤ 0.08 m, not past the point) and heading within ±0.5 rad. */
const LINED_UP_SIDEWAYS = 0.08
const LINED_UP_YAW = 0.5
/** The line-up point is a pass-through: this close counts. */
const LINE_UP_RADIUS = 0.15

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

interface LegTarget {
  readonly x: number
  readonly y: number
  /** The heading to turn to on arrival (an arc: see waypoint.js ARC_VX), or null for none. */
  readonly yaw: number | null
}

/** One walk through the engine's waypoint source; resolves when it arrives, gives up, or times out. */
const leg = (
  engine: EngineContext,
  target: LegTarget,
  options: { readonly arriveRadius?: number; readonly lineYaw?: number } = {},
) =>
  new Promise<{ readonly ok: boolean; readonly reason: string }>((resolve) => {
    const timer = setTimeout(() => engine.waypointSource.cancel(), WALK_TIMEOUT_MS)
    engine.waypointSource.setTarget(target.x, target.y, {
      arriveRadius: options.arriveRadius ?? 0.08,
      faceYaw: target.yaw,
      lineYaw: options.lineYaw ?? null,
      yawTol: FACE_TOLERANCE,
      onDone: (result) => {
        clearTimeout(timer)
        resolve({ ok: result.ok, reason: result.reason ?? 'arrived' })
      },
    })
  })

/** True when the duck already stands on the target's approach line, facing roughly the target heading. */
const linedUp = (engine: EngineContext, target: Point) => {
  const [x, y, yaw] = engine.getPose()
  const along = (x - target.x) * Math.cos(target.yaw) + (y - target.y) * Math.sin(target.yaw)
  const sideways = -(x - target.x) * Math.sin(target.yaw) + (y - target.y) * Math.cos(target.yaw)
  const yawError = Math.atan2(Math.sin(target.yaw - yaw), Math.cos(target.yaw - yaw))
  return along <= 0.02 && Math.abs(sideways) <= LINED_UP_SIDEWAYS && Math.abs(yawError) <= LINED_UP_YAW
}

/**
 * Walk to `target`. With a line-up point: pass through it loosely (no turn there) unless already lined up, then run in
 * along the approach line, which arrives facing `yaw` with no turn at the end (a turn there would arc the duck off its
 * spot in front of the screen). A fall during the line-up shows up as the run-in being overridden by the recovery.
 */
const route = async (engine: EngineContext, target: Point) => {
  if (target.via === undefined) return leg(engine, target)
  if (!linedUp(engine, target)) await leg(engine, { ...target.via, yaw: null }, { arriveRadius: LINE_UP_RADIUS })
  return leg(engine, { ...target, yaw: null }, { lineYaw: target.yaw })
}

export const makeBody = (engine: EngineContext): Body => {
  let falls = 0
  let wasDown = false
  let downSince: number | null = null

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
      const result = await route(engine, target)
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
