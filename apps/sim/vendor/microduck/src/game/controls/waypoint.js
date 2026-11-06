// Waypoint input source (see controller.js for the source interface
// contract). PLAN.md Project 1 Phase A: click a point on the arena floor,
// the duck walks there. No new policy - this only turns a click into the
// same [vx, vy, wz] twist the walking policy already tracks.
//
// Click, not drag-follow: the mouse already drives OrbitControls (camera
// orbit) and the duck/ball grab-drag, so a live cursor-follow twist would
// fight both. A plain click (small movement, short hold) on empty floor
// is otherwise unclaimed input, and reads naturally as "go here" - the
// same gesture Project 5's tile grid uses.
//
// Arbitration: registered LAST in game.js's source list, so it is the
// Controller's fallback exactly like the keyboard source used to be -
// any keyboard/pad/touch input immediately preempts it (see
// controller.js's arbitration notes), and getManualOverride() cancels the
// pending target outright so releasing manual input doesn't snap the duck
// back onto a stale click.

import * as THREE from "three";
import { ARENA_HALF } from "../constants.js";

const WAYPOINT_ARRIVE_RADIUS = 0.12; // m, dead zone - commands zero inside it
const WAYPOINT_TURN_GAIN = 2.2; // rad/s commanded per rad of heading error, pre-clamp
const WAYPOINT_SMOOTH_ALPHA = 0.15; // EMA toward the steered command, per render frame
const WAYPOINT_CLICK_SLOP = 6; // px, pointerdown -> pointerup movement budget for a "click"
const WAYPOINT_CLICK_MS = 500; // ms, pointerdown -> pointerup duration budget
// Vitaquack (6 Nov e2e run): below about 0.15 m/s forward the walking policy treats the command as "stand" and a pure
// turn in place (vx 0, |wz| up to 1) stalls after ~0.2 rad, either way, at random; with vx >= 0.15 the same turn is an
// arc that finishes in 2-5 s (8 of 8). So programmatic targets never command a pure turn, and a face turn that still
// does not finish gives up after FACE_MAX_MS of wall time rather than holding its caller for the whole walk timeout.
const ARC_VX = 0.15; // m/s, the forward floor of every programmatic move and face command
const FACE_MAX_MS = 12000;
const LINE_LOOKAHEAD = 0.35; // m, the pure-pursuit carrot's lead on a line approach
const LINE_ARRIVE_SIDEWAYS = 0.15; // m, how far beside the target a line approach may cross its line

const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// Three world (x, y, z) -> MJCF ground (x, -z); floor sits at three y = 0.
const FLOOR_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

export class WaypointSource {
  id = "waypoint";
  connected = true; // a mouse is assumed present, like the keyboard
  command = new Float32Array(3); // [vx, 0, wz], EMA-smoothed toward the target
  axes = { jaw: 0, orbitX: 0, orbitY: 0 }; // drives none of these
  pressed = {};
  onAction = () => {}; // assigned by the Controller at registration

  #camera;
  #renderer;
  #getVelocityLimits;
  #getDuckPose; // () => [x, y, yaw] MJCF ground pose
  #isSuppressed; // () => true while a click must not arm (grabbing, locked, wrong mode)
  #getManualOverride; // () => true while another source is actively driving
  #target = null; // [x, y] MJCF, or null when idle
  // Vitaquack: programmatic targets (setTarget) carry their own arrival
  // radius, an optional final heading to turn to in place, and a callback.
  #prog = null; // { arriveRadius, faceYaw, yawTol, onDone, phase: "move"|"face" }
  #active = false;
  #downAt = null; // { x, y, t } pointerdown snapshot, for the click-vs-drag check
  #raycaster = new THREE.Raycaster();
  #ndc = new THREE.Vector2();
  #hit = new THREE.Vector3();
  #onDown = null;
  #onUp = null;

  constructor({ camera, renderer, getVelocityLimits, getDuckPose, isSuppressed, getManualOverride }) {
    this.#camera = camera;
    this.#renderer = renderer;
    this.#getVelocityLimits = getVelocityLimits;
    this.#getDuckPose = getDuckPose;
    this.#isSuppressed = isSuppressed;
    this.#getManualOverride = getManualOverride;
  }

  init() {
    this.#onDown = (e) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      if (e.target !== this.#renderer.domElement) return;
      if (this.#isSuppressed()) return;
      this.#downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    };
    this.#onUp = (e) => {
      if (!this.#downAt || e.pointerType !== "mouse" || e.button !== 0) { this.#downAt = null; return; }
      const { x, y, t } = this.#downAt;
      this.#downAt = null;
      if (this.#isSuppressed()) return;
      const moved = Math.hypot(e.clientX - x, e.clientY - y);
      const held = performance.now() - t;
      // A drag (orbit or grab) shows up as either more movement than a
      // click budget allows, or a slow deliberate press - either way, not
      // a click.
      if (moved > WAYPOINT_CLICK_SLOP || held > WAYPOINT_CLICK_MS) return;
      // Vitaquack: a click on the scene (say, to leave the errand box) does not replace a walk the errand is driving;
      // Stop in the owner's panel, or the keys, still take over.
      if (this.#prog) return;
      this.#setTargetFromEvent(e);
    };
    window.addEventListener("pointerdown", this.#onDown);
    window.addEventListener("pointerup", this.#onUp);
  }

  dispose() {
    window.removeEventListener("pointerdown", this.#onDown);
    window.removeEventListener("pointerup", this.#onUp);
  }

  isActive() {
    return this.#active;
  }

  // Current target in MJCF ground coords, or null - read by game.js to
  // place the click marker. Read-only.
  get target() {
    return this.#target;
  }

  // Cancel a pending target without walking it down (sim reset, mode
  // change out from under it).
  // Vitaquack: drive to an MJCF ground point under code control.
  // Vitaquack: `lineYaw` makes the move follow the line through the target along that heading (pure pursuit of a
  // point LINE_LOOKAHEAD ahead on it), so the duck arrives already facing `lineYaw`.
  setTarget(x, y, { arriveRadius = WAYPOINT_ARRIVE_RADIUS, faceYaw = null, yawTol = 0.1, onDone = null, lineYaw = null } = {}) {
    const lim = ARENA_HALF - 0.05;
    this.#prog?.onDone?.({ ok: false, reason: "superseded" });
    this.#target = [Math.min(lim, Math.max(-lim, x)), Math.min(lim, Math.max(-lim, y))];
    this.#prog = { arriveRadius, faceYaw, yawTol, onDone, lineYaw, phase: "move", best: Infinity, stall: 0 };
  }

  // Vitaquack: turn in place to an absolute MJCF yaw.
  faceYaw(yaw, { yawTol = 0.1, onDone = null } = {}) {
    const [px, py] = this.#getDuckPose();
    this.#prog?.onDone?.({ ok: false, reason: "superseded" });
    this.#target = [px, py];
    this.#prog = { arriveRadius: Infinity, faceYaw: yaw, yawTol, onDone, phase: "face" };
  }

  get programmatic() {
    return this.#prog ? { ...this.#prog, onDone: undefined } : null;
  }

  #finishProg(result) {
    const p = this.#prog;
    this.#prog = null;
    p?.onDone?.(result);
  }

  cancel() {
    if (this.#prog) this.#finishProg({ ok: false, reason: "cancelled" });
    this.#target = null;
    this.#active = false;
    this.command.fill(0);
  }

  poll(dt = 1 / 60) {
    if (this.#target && this.#getManualOverride()) {
      this.#target = null;
      if (this.#prog) this.#finishProg({ ok: false, reason: "manual-override" });
    }
    if (this.#target && this.#prog) {
      this.#pollProg(dt);
      return;
    }
    if (!this.#target) {
      this.command.fill(0);
      this.#active = false;
      return;
    }
    const [px, py, yaw] = this.#getDuckPose();
    const dx = this.#target[0] - px, dy = this.#target[1] - py;
    const dist = Math.hypot(dx, dy);
    if (dist < WAYPOINT_ARRIVE_RADIUS) {
      this.#target = null;
      this.command.fill(0);
      this.#active = false;
      return;
    }
    const err = wrapPi(Math.atan2(dy, dx) - yaw);
    const [limF, , limA] = this.#getVelocityLimits();
    const wz = Math.min(limA, Math.max(-limA, err * WAYPOINT_TURN_GAIN));
    // Forward speed falls off with heading error so the duck turns in
    // place first rather than strafing (there is no strafe) toward a
    // target that's behind it.
    const vx = limF * Math.max(0, Math.cos(err));
    this.command[0] += WAYPOINT_SMOOTH_ALPHA * (vx - this.command[0]);
    this.command[2] += WAYPOINT_SMOOTH_ALPHA * (wz - this.command[2]);
    this.#active = true;
  }

  #pollProg(dt) {
    const p = this.#prog;
    const [px, py, yaw] = this.#getDuckPose();
    const [limF, , limA] = this.#getVelocityLimits();
    let vx = 0, wz = 0;
    if (p.phase === "move") {
      const dx = this.#target[0] - px, dy = this.#target[1] - py;
      const dist = Math.hypot(dx, dy);
      // Vitaquack: on a line approach, reaching the target's crossing line close enough sideways is arriving.
      const crossed =
        p.lineYaw != null &&
        -(dx * Math.cos(p.lineYaw) + dy * Math.sin(p.lineYaw)) >= -0.02 &&
        Math.abs(dx * Math.sin(p.lineYaw) - dy * Math.cos(p.lineYaw)) < LINE_ARRIVE_SIDEWAYS;
      if (dist < p.arriveRadius || crossed) {
        if (p.faceYaw == null) {
          this.#target = null;
          this.command.fill(0);
          this.#active = false;
          this.#finishProg({ ok: true, pose: [px, py, yaw], dist });
          return;
        }
        p.phase = "face";
      } else {
        // Orbit guard: no strafe means a duck that reaches the target
        // ring sideways can circle it. Accept (settled) once it has stopped
        // improving for 2 s within 1.5x the radius.
        if (dist < p.best - 0.005) { p.best = dist; p.stall = 0; } else p.stall += dt;
        if (p.stall > 2 && dist < p.arriveRadius * 1.5) {
          if (p.faceYaw == null) {
            this.#target = null; this.command.fill(0); this.#active = false;
            this.#finishProg({ ok: true, settled: true, pose: [px, py, yaw], dist });
            return;
          }
          p.phase = "face";
        }
      }
      if (p.phase === "move") {
        const dx = this.#target[0] - px, dy = this.#target[1] - py;
        const dist = Math.hypot(dx, dy);
        // Vitaquack: on a line approach, steer at the carrot: the duck's projection on the line, LINE_LOOKAHEAD
        // further along it (past the target too, so the heading settles onto the line's).
        let aimX = dx, aimY = dy;
        if (p.lineYaw != null) {
          const ux = Math.cos(p.lineYaw), uy = Math.sin(p.lineYaw);
          const ahead = -(dx * ux + dy * uy) + LINE_LOOKAHEAD;
          aimX = dx + ux * ahead;
          aimY = dy + uy * ahead;
        }
        const err = wrapPi(Math.atan2(aimY, aimX) - yaw);
        wz = Math.min(limA, Math.max(-limA, err * WAYPOINT_TURN_GAIN));
        // Slow down on the final approach; near the target turn in place
        // first when the heading is off (no strafe).
        const slow = Math.min(1, Math.max(0.35, dist / 0.3));
        const near = dist < 0.3 && Math.abs(err) > 0.45;
        // Vitaquack: never below ARC_VX, so a sharp heading change is an arc, not a stalled turn in place.
        vx = Math.max(ARC_VX, near ? 0 : limF * slow * Math.max(0, Math.cos(err)) ** 2);
        if (near) wz = Math.sign(err) * Math.max(0.35, Math.abs(wz));
      }
    }
    if (p.phase === "face") {
      const err = wrapPi(p.faceYaw - yaw);
      if (Math.abs(err) < p.yawTol) {
        this.#target = null;
        this.command.fill(0);
        this.#active = false;
        this.#finishProg({ ok: true, pose: [px, py, yaw], yawErr: err });
        return;
      }
      p.faceStart ??= performance.now();
      if (performance.now() - p.faceStart > FACE_MAX_MS) {
        this.#target = null;
        this.command.fill(0);
        this.#active = false;
        this.#finishProg({ ok: false, reason: "face-stalled", pose: [px, py, yaw], yawErr: err });
        return;
      }
      // Minimum turn rate so the policy actually rotates near the goal.
      const w = err * WAYPOINT_TURN_GAIN;
      wz = Math.sign(w) * Math.min(limA, Math.max(0.35, Math.abs(w)));
      // Vitaquack: a small forward arc instead of a pure turn in place (see ARC_VX).
      vx = ARC_VX;
    }
    // Frame-rate independent smoothing (tau 0.15 s): the per-frame EMA
    // above assumes ~60 fps and lags for seconds at SwiftShader rates.
    const a = 1 - Math.exp(-Math.min(dt, 0.25) / 0.15);
    this.command[0] += a * (vx - this.command[0]);
    this.command[2] += a * (wz - this.command[2]);
    this.#active = true;
  }

  #setTargetFromEvent(e) {
    const r = this.#renderer.domElement.getBoundingClientRect();
    this.#ndc.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    );
    this.#raycaster.setFromCamera(this.#ndc, this.#camera);
    if (!this.#raycaster.ray.intersectPlane(FLOOR_PLANE, this.#hit)) return;
    const lim = ARENA_HALF - 0.05;
    if (this.#prog) this.#finishProg({ ok: false, reason: "click" });
    this.#target = [
      Math.min(lim, Math.max(-lim, this.#hit.x)),
      Math.min(lim, Math.max(-lim, -this.#hit.z)), // three -> MJCF
    ];
  }
}
