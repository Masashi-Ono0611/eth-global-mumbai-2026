# Provenance

Pollen Robotics' Microduck sandbox app (`app/src` of the Hugging Face Space
[pollen-robotics/microduck-simulator](https://huggingface.co/spaces/pollen-robotics/microduck-simulator), commit
`ad9d41a763f30dc770817c33d92dcfec0205db1e`, "chore: license the app under Apache 2.0"), Apache-2.0 (`LICENSE`,
copied from the Space's root). It is the duck's body for Vitaquack's simulator robot: MuJoCo WASM physics, the trained
ONNX walking policy at 50 Hz, the three.js rig, the R3F canvas and Pollen's HUD.

## Not vendored

- The Space's `app/public/` assets (STL meshes, `microduck.glb`, MJCF XML, `kinematics*.json`, the ONNX policies,
  audio, stickers, prop GLBs). The meshes and models are CC BY-NC-SA / model-licensed and are never committed: the
  page fetches them at runtime from the Space, pinned to the commit above (`src/game/signed.js`), and credits Pollen
  in its footer. The Space serves them with `access-control-allow-origin: *` (checked 6 Nov 2026).
- `src/game/ghosts.js` (multiplayer ghosts over public nostr relays, and its `trystero` dependency).
- `src/game/fx/demo-*.html` (stand-alone effect demos), the Space's `test/`, `index.html`, `vite.config.js` and
  `package.json` (apps/sim has its own, with the same dependency pins).

## Local changes (all marked `Vitaquack:` in the source)

- `src/game/game.js`: imports `vqBridge` from `apps/sim/src/bridge.ts` and appends its stall colliders to the MJCF,
  calls its per-frame `tick`, installs it with the engine context (scene, renderer, camera, rig, pose, waypoint source,
  fall recovery state, a standing `teleport`); no ball auto-spawn; ghosts disabled (Spike A, 6 Nov 2026).
- `src/game/controls/waypoint.js`: programmatic `setTarget`/`faceYaw` with arrival callbacks, frame-rate independent
  smoothing, slow final approach, turn-in-place and an orbit guard (Spike A). Since the 6 Nov end-to-end run: a
  0.15 m/s forward floor on every programmatic command (the policy stalls a pure turn in place, so turns are arcs), a
  12 s wall-clock cap on the face turn, and `lineYaw`, a pure-pursuit line approach that arrives facing along the line.
- `src/game/signed.js`: page-relative asset URLs are rebased onto the Space at the pinned commit.
- `src/App.jsx`: the title menu is skipped unless `?boot=0`.
- `src/scene/CrtDistortion.jsx`, `src/scene/GameCanvas.jsx`: the CRT pass and MSAA are off unless `?crt=1` / `?aa=1`
  (CPU renderers draw 2.6 fps with them, 10-15 without); `?dpr=` pins the pixel ratio.
- `src/ui/Hud.jsx`, `src/ui/TitleMenu.jsx`: no pre-order button to Pollen's store (7 Nov 2026). Pollen is credited, with
  a link, at the foot of the owner's panel.
- `src/ui/Hud.jsx`, `src/game/game.js`: no colour/locomotion quickbar, and the loco toggle (M key, gamepad) is not
  wired, so the sim duck walks on its feet only (7 Nov 2026).
- `src/game/controls/keyboard.js`, `src/ui/TitleMenu.jsx`: keys typed into a text field (the owner's errand box) do
  not drive the duck or the title/pause menu (`isTypingTarget`, 7 Nov 2026).
- `src/game/controls/waypoint.js`: a click on the scene does not replace a programmatic walk (an errand's `go_to`);
  the keys still take over (7 Nov 2026).

## Checks

Ignored by oxlint, oxfmt, jscpd, knip and the graph/suppression scanners (`tools/quality/source.ts`), as
`tools/oxlint/anti-slop` and `repos/` are: it is upstream JavaScript, not ours. Every file is pinned by SHA-256 in
`tools/provenance.json` (`bun run provenance:check`), so any edit has to be deliberate and re-recorded.

Update: diff the Space at a new commit against `references/pollen-robotics_microduck-simulator/app/src`, reapply the
local changes above, bump the commit in `signed.js` and here, and refresh the hashes.
