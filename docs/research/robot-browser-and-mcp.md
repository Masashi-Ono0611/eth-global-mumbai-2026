# Research: robot camera and control from the browser, and the robot as an MCP server

Written 2026-11-05 (event day 1) for system 2, the AI client that also drives the robot, and for
iteration 2 (the duck with cameras). It builds on `robots-and-embedded.md` (hardware, the Radxa
camera-connector fault, the Microduck daemons), `0g.md` (decision loop, safe-stop rules) and
`../infrastructure.md` (one `RobotSession` Durable Object per robot; robots connect outbound over
WebSocket). It defers to the sibling note `mcp-wallet-and-ai-client.md` on the MCP server stack, the
AI client's runtime and the 0G model catalogue. New clones are in `../../references/` (table in section 9).

**Confidence tags:** **Known** = read in source or official docs, or measured by someone and
written down; **Uncertain** = plausible, needs a spike; **Unknown** = needs research or a team
decision. Numbers marked "estimate" are my inference.

## TL;DR

1. **Camera to browser: send JPEG frames over the robot's existing WebSocket to `RobotSession`,
   and let the DO fan them out to viewers.** It works behind any venue NAT, because both ends dial
   out. It needs no TURN, SFU or extra service, and it reuses the socket we already need for control.
   The same latest frame feeds the AI's `look` tool and the 0G vision call. Pollen built the same
   thing as their fallback (`mediad` `media.stream`: the robot dials a `wss://` and pushes frames).
   WebRTC is a stretch goal: go2rtc on the Radxa, signalled through the DO, with Cloudflare TURN for
   the browser. Do not build on Cloudflare Realtime SFU or LiveKit this weekend.
2. **Use a USB UVC webcam in MJPEG mode unless the CSI camera is proven safe.** The camera's JPEGs
   can then be forwarded without decoding, at near-zero CPU. On the CSI path (IMX219 via rkisp)
   every frame is a CPU JPEG encode on 4×A55 cores, and the board may have the bottom-contact
   connector defect.
3. **Browser control: Foldkit page → WebSocket → `RobotSession` → robot.** Gamepad API plus
   keyboard. Send `robot.move {vx,vy,vyaw}` at 10 Hz while the stick is deflected, then one
   explicit zero on release (Microduck's own console does this). Three layers of stop:
   - a deadman inside the robot's control loop (300 ms, as in quackd's Open Duck Mini bridge),
   - a single-writer lease and a latched e-stop in the DO,
   - the power switch.

   A human always outranks the AI.
4. **The robot MCP server lives in our Worker, not on the robot.** Serve it from the same MCP stack
   as the wallet MCP. `mcp-wallet-and-ai-client.md` picks Cloudflare `createMcpHandler` + MCP SDK v2
   behind `workers-oauth-provider`, and reports that Effect 4.0.7's `McpServer` can't serve both
   protocol lanes on Workers. Tool handlers are RPCs into `RobotSession`.
   - Tools: `robot_status`, `look` (returns MCP `ImageContent`), `scan_qr`, `move` (bounded, at
     most 2 s), `approach_qr` (a reflex skill run below the AI), `stop`, and probably
     `pay_scanned_invoice`.
   - The AI holds a lease that only a fresh 0G decision renews. If 0G is unreachable, the lease
     lapses and the duck stops. That is the prize's safe-stop, and it is structural: no fake
     decision is possible.
5. **Virtual robot (iteration 1.5): fork Pollen's Microduck sandbox.** It runs MuJoCo-WASM and
   onnxruntime-web with the real RL walking policy; the app code is Apache-2.0, but the meshes are
   CC BY-NC-SA (non-commercial). Make it a browser "sim robot" that speaks the same `RobotSession`
   protocol as the real duck:
   - a `RemoteSource` feeds commands into its existing input-arbitration layer,
   - a head-mounted three.js camera produces JPEG frames,
   - a QR stand sits in the arena.

   A headless Bun mock covers tests. 0G allows a "replayable simulation" for all places except the
   hardware prize.
6. **Closest prior art is not from 0G.**
   - **quackd** ([rokbenko/quackd](https://github.com/rokbenko/quackd), Apache-2.0, 289★): an LLM
     brain for Microduck and Open Duck Mini, with `serve-mcp`, an executor that enforces allowlists,
     budgets, a heartbeat and a kill switch, and an ODM bridge daemon that replaces the Xbox pad with
     a network source.
   - 0G's own examples (zerobot, floaty, reachy-mini-hackathon) show 0G in the loop. None streams a
     camera to a browser through a server.

---

## 1. Constraints that shape every choice

| Constraint | Consequence | Confidence |
| --- | --- | --- |
| The robot is Kris's **modified Open Duck Mini** on a **Radxa Zero 3W** (RK3566), not a Microduck | Microduck's `robotd` drives Dynamixel XL330s and won't drive our servos. Its media and web parts are reusable as patterns, and only as code if the brain runs Pollen's image. ODM's runtime has **no network API and no deadman**: an Xbox thread feeds 7 floats at 20 Hz (`Open_Duck_Mini_Runtime/mini_bdx_runtime/xbox_controller.py`) | Known |
| Venue Wi-Fi: NAT, probably client isolation | Nothing can dial *into* the robot. Both the robot and the browser dial out to Cloudflare. LAN WebRTC between two venue devices may fail; bring a travel router or phone hotspot for the bench | Known (NAT) / Uncertain (isolation) |
| RK3566's hardware H.264 is reached via **Rockchip MPP** (`/dev/mpp_service`), not V4L2 M2M, and only on the vendor (BSP) kernel | No `v4l2h264enc`. You need `gstreamer1.0-rockchip` (`mpph264enc`) or `ffmpeg-rockchip` (`h264_rkmpp`). A non-root process gets an empty file and exit 0 unless a udev rule opens the node (`pollen-robotics_microduck/docs/project/media-bringup.md`) | Known |
| The CSI connector on some Zero 3W batches is bottom-contact, so the ribbon shorts 3V3 to GND | Prefer a USB UVC webcam on USB-C 2 (`robots-and-embedded.md` §2) | Known that the issue exists |
| 0G prize: "A safe-stop fallback if 0G is unreachable. A fallback that fakes the decision disqualifies." | The robot must stop, not guess, when the brain is gone. Motion and reflexes stay below 0G ("brain, not spinal cord") | Known (`0g.md` §1) |
| `RobotSession` is one DO per robot that holds the robot's socket | That makes it the natural single writer: lease, e-stop latch, rate limits, latest frame, MCP tool target | Known (`infrastructure.md`) |

## 2. Robot camera → browser

### 2.1 Options

| Option | How it reaches a browser behind NAT | Latency (estimate) | Robot CPU on RK3566 | Effort | Verdict |
| --- | --- | --- | --- | --- | --- |
| **A. JPEG frames over the robot's WebSocket → `RobotSession` → viewer WebSockets** | Both sides dial out; nothing to traverse | ~150–400 ms glass to glass (capture + encode + 2 hops via the DO) | Near zero with UVC MJPEG passthrough. CSI: one CPU JPEG per frame (estimate 15–40% of a core at 10 fps 640×480; Pollen: GStreamer `jpegenc` "cannot hold 30 fps at 640x480 on this SoC") | **Hours.** One binary message type, a canvas on the page | **Recommended baseline** |
| B. MJPEG over HTTP (`multipart/x-mixed-replace`, e.g. go2rtc `/api/stream.mjpeg`) | Only via a tunnel (cloudflared/Tailscale). The Worker can't proxy a long-lived stream from a NAT'd robot without the WS anyway | ~150–300 ms | Same as A | Minutes on the LAN, more for the tunnel | Bench/dev only (Tailscale tailnet) |
| C. **go2rtc** WebRTC on the robot, signalled over our DO (browser offer → DO → robot sidecar → `POST localhost:1984/api/webrtc?src=cam` → answer), with **Cloudflare TURN** creds minted by the Worker | ICE: STUN, then TURN. One relay candidate (the browser's) is enough | ~100–250 ms | UVC H.264 passthrough: ~0. MJPEG/raw → H.264 needs `ffmpeg-rockchip` `h264_rkmpp` (tested by go2rtc on an Orange Pi 3B, which is an RK3566, with Armbian 6.1), else software x264 (estimate 60–120% of a core at 480p15, which is a bad idea next to a 50 Hz policy) | Half a day to a day, plus OS-image risk | **Stretch goal**, after A works |
| D. Microduck **`mediad`** (`webrtcsink` + `mpph264enc` + datachannel; Cloudflare TURN via an HF proxy) | WebRTC; the robot offers its own relay; remote via the HF rendezvous | Low (WebRTC) | **Measured: 720p30 at 29.3 fps, about 25% of one core in total**, with congestion control the largest consumer | Needs Pollen's image: gst-plugins-rs built from source and the `mpph264enc` WebRTC fix, plus their HF account flow. Coupled to `robotd` | Only if the brain runs Pollen's stack. Not for our ODM |
| E. GStreamer `webrtcbin` hand-rolled | WebRTC | Low | Hardware H.264 via `mpph264enc` | We write signalling and session handling ourselves (Pollen chose `webrtcsink` to avoid this) | No |
| F. **aiortc** (Python) on the robot | WebRTC | Low to medium | Software encode only in practice. Pollen notes aiortc's **TURN client doesn't work where its STUN does**, so the other side must relay | Medium | No (CPU) |
| G. **Cloudflare Realtime SFU**: the robot publishes, browsers subscribe; the WebSocket adapter turns video into JPEG for the AI | WebRTC to Cloudflare's anycast SFU | Low | Needs a WebRTC publisher on the robot (C, D or F). There is no WHIP client on stock Debian (go2rtc publishes RTMP only; WHIP *ingest* is legacy example code) | High. The `cloud-gaming` example is the blueprint (Container publisher, DO with controller generations, DataChannels for input) | Post-hackathon. 1,000 GB/month free across SFU and TURN; JPEG adapter is **1 fps by default and egress only** |
| H. LiveKit (Cloud Build plan or self-hosted) | WebRTC SFU | Low | Same publisher problem | High; another service and SDK | No. Free tier ~5,000 WebRTC min, 50 GB (third-party figures) |
| I. MediaMTX on the robot (RTSP in, WHEP out) | WebRTC, needs TURN for remote | Low | Like C; an RK3566 needs ffmpeg-rockchip in front of it | Medium | Equivalent to C. go2rtc has the better v4l2 and rkmpp story |

What I read for the RK3566 rows:

- `mediad`'s CPU breakdown and the 29.3 fps: `pollen-robotics_microduck/docs/design/remote-webrtc.md` §0.
  Two capture traps are documented there:
  - rkisp needs **≥3 capture buffers**;
  - ask for **UYVY**, not NV12/NM12. `mpph264enc` converts on the RGA at no CPU cost.
- Browsers offer `profile-level-id=42e01f` (level 3.1). `mpph264enc` advertised a fixed level 4.0, so
  H.264 vanished from the offer. Fixed upstream in [JeffyCN/mirrors#83](https://github.com/JeffyCN/mirrors/pull/83)
  (merged 2026-10-20, tested on a Radxa Zero 3W). Older distro packages will still have the bug, and
  the same level mismatch is a risk for go2rtc/ffmpeg (Uncertain).
- go2rtc on RK3566: [go2rtc hardware README](https://github.com/AlexxIT/go2rtc/blob/master/internal/ffmpeg/hardware/README.md)
  says to use the [nyanmisaka ffmpeg-rockchip](https://github.com/nyanmisaka/ffmpeg-rockchip) build
  ([MarcA711 static builds](https://github.com/MarcA711/Rockchip-FFmpeg-Builds/releases/)) on a 5.10/6.1
  kernel. Its native v4l2 source (v1.9.9+) passes MJPEG/H.264 through "without CPU usage"
  (`references/AlexxIT_go2rtc/internal/v4l2/README.md`).

### 2.2 Recommended design for (A)

```
camera ─► robot "camd" (newest frame only) ─► WS binary ─► RobotSession DO ─► viewers (WS, credit 1)
                                                   │
                                                   └─► latest frame in memory ─► MCP look / scan_qr / 0G
```

- **Capture process.** Keep it separate from the walk loop. quackd's ODM bridge does this
  (`quackd_duck_camd.py`: own process, OOM score set so the kernel kills it before the walk loop,
  captures on a timer, serves the newest frame).
  - UVC: open `/dev/videoN` as MJPEG 640×480 (or 1280×720) and forward the camera's JPEG bytes as is.
  - CSI: UYVY from rkisp, then OpenCV `imencode` at 640 px, q≈70.
  - Rotate on the robot, so frames are always upright. Pollen's camera is mounted at 90°.
- **Wire.**
  - One binary WS message per frame: a small header (`kind=frame`, `frameId`, `capturedAtMs`,
    `w`, `h`), then the JPEG bytes.
  - Control and telemetry go as JSON text on the same socket.
  - Workers accept received WebSocket messages up to **32 MiB**
    ([limits](https://developers.cloudflare.com/durable-objects/platform/limits/)), and a 640 px
    JPEG is about 30–60 KB (estimate).
- **Stream only while watched.** Floaty does this (`0gfoundation_project-floaty/PROTOCOL.md`): the
  hub tells the robot `{"t":"config", ...}` when a viewer arrives and stops it 30 s after the last
  one leaves.
  - The DO sends `{t:"video", fps:5}` or `{fps:0}`.
  - Otherwise the DO asks for a single snapshot on demand (`{t:"snapshot", reqId}`), which is what
    `look` uses.
- **Flow control with credits, so latency never builds up.**
  - Each viewer has one frame in flight. It sends `ack` after drawing, and the DO then sends the
    *newest* frame, never a queue.
  - Slow viewers get fewer frames, not older ones. The robot side gets the same rule from the DO.
- **Browser.**
  - `createImageBitmap(new Blob([jpeg], {type: "image/jpeg"}))`, then draw to a `<canvas>`.
  - Show the **frame age** (`now − capturedAtMs`, after a clock-offset handshake) and grey the picture
    out past 1 s. A teleop UI must never show a stale picture as live.
- **Cost.**
  - Incoming DO WebSocket messages bill at 20:1
    ([DO release notes](https://developers.cloudflare.com/durable-objects/release-notes/)), and
    outgoing are free. 10 fps for an hour is 36k messages, billed as about 1.8k requests.
  - A DO soft limit of 1,000 req/s is far away.
  - DO placement: create the robot's DO with `locationHint: "apac"`
    ([data location](https://developers.cloudflare.com/durable-objects/reference/data-location/)),
    so it doesn't land in whatever region the first request came from.
- **Evidence.** When a frame is used in a decision, hash it (sha256), put it in R2 and record the
  hash in the episode log next to the 0G `request_id` (`0g.md` §6). Never store every frame.
- **Rates.** Use 5 fps 640 px for humans (about 1–2 Mbit/s per viewer, estimate) and on-demand
  snapshots for the AI. Viewers can ask for 10 fps if the Wi-Fi allows it.

### 2.3 If there is time: the WebRTC upgrade (C)

1. On the Radxa, run go2rtc (one static arm64 binary, MIT), with source `v4l2:device?video=/dev/video0&input_format=mjpeg…`.
   For a browser-compatible H.264 track there are two routes:
   - a UVC camera with native H.264 (passthrough);
   - `ffmpeg:…#video=h264#hardware=rkmpp` with ffmpeg-rockchip, on the vendor kernel.
2. The browser creates an offer and sends it over its WS to the DO. The robot sidecar POSTs it to
   go2rtc on localhost and sends back the answer.
   - The Worker mints Cloudflare TURN credentials for the browser:
     `POST https://rtc.live.cloudflare.com/v1/turn/keys/$TURN_KEY_ID/credentials/generate-ice-servers`
     with `{"ttl": …}` ([docs](https://developers.cloudflare.com/realtime/turn/generate-credentials/)).
     Filter out the port-53 URL, which browsers block.
   - TURN shares the 1,000 GB/month free tier with the SFU
     ([pricing](https://developers.cloudflare.com/realtime/sfu/platform/pricing/)).
3. Keep (A) running anyway: the AI and evidence still use the DO's frames, and the page falls back
   to them when ICE fails.

## 3. Browser teleop

### 3.1 Path and message shape

```
Gamepad API / keys (rAF poll) ─► page sends robot.move @10 Hz while non-zero, one zero on release
   ─► WS ─► RobotSession: auth, lease check, clamp, seq check, last-writer-wins
   ─► robot WS ─► adapter ─► policy input (ODM last_commands / Microduck robotd.sock)
robot: in-loop deadman 300 ms → velocities zeroed (stand still, not limp)
```

Use **Microduck's vocabulary on our wire**: JSON-RPC 2.0 notifications for continuous intents
(`robot.move {vx,vy,vyaw}`, `robot.head {...}`), and requests for discrete ones (`robot.stop`,
`robot.state` subscription). Units are SI, trunk frame, vx forward, vy left, vyaw counter-clockwise
(`pollen-robotics_microduck/docs/design/robotd-design.md` §3.1).

- On a Microduck the robot side is a dumb pipe to `/run/robotd.sock`.
- On our ODM an adapter writes the same numbers into the policy's command slot.
- The sim speaks it too.

Add `seq` (monotonic per lease generation) so that a reordered or duplicated message can't win
last-writer-wins. Pollen requires this the moment intents go over an unordered channel
(`remote-webrtc.md` §6).

### 3.2 Mapping velocity intents onto each body

| | Microduck `robot.move` | Our ODM (`last_commands`) | Microduck MuJoCo-WASM sim |
| --- | --- | --- | --- |
| Shape | `{vx, vy, vyaw}` m/s, rad/s; head is a separate `robot.head` slot | 7 floats `[vx, vy, vyaw, neck_pitch, head_pitch, head_yaw, head_roll]`, read once per 50 Hz tick | `Controller` command `Float32Array(3) [vx, vy, wz]` |
| Limits | Pad defaults vx ±0.4, vy ±0.3, vyaw ±1.0 (`deploy/robotd.toml [pad_drive]`); the web console uses 0.3 m/s and 1.5 rad/s full deflection | X ±0.15, Y ±0.2, yaw ±1.0 (`xbox_controller.py`). The walk policy only follows commands inside its training range | Per variant `getVelocityLimits()`; rollers up to 0.6 m/s |
| Deadman | `robotd` `safety.deadman_ms = 500`; `netpadd` `stale_ms = 300`, `timeout_ms = 1000` | **None upstream.** Add one: quackd's bridge replaces `XBoxController` with a `NetworkController` whose `get_last_command()` zeroes velocities if no command arrived within 300 ms, evaluated in the control thread (`rokbenko_quackd/bridge/open_duck/quackd_duck_bridge.py`) | Add one in the `RemoteSource` |
| Send rate | Console: 10 Hz while non-zero, then one explicit zero (`mediad/webclient/index.html`) | Xbox thread at 20 Hz | Every render frame |

The robot announces its limits in its hello. The page scales the normalised stick (−1..1, with a
0.1 deadzone, as in Microduck's `pad_axes.deadzone`) to those limits. With the Gamepad API
"standard" mapping, `vx = −axes[1]` and `vyaw = −axes[2]`.

### 3.3 Safety, in layers (fail-safe from the bottom)

| Layer | Mechanism | Covers |
| --- | --- | --- |
| Body | Power switch; on ODM it is "the only e-stop" (quackd). Fit a reachable kill switch on the servo rail | Everything |
| Robot runtime | In-loop deadman (300 ms) and clamps to the ODM ranges. A **stop latch**: after `robot.stop` or an e-stop, ignore `move` until a `resume` carrying a *new* lease generation. A dropped WS is just silence, so the deadman fires. Stop means stand still, not limp (Microduck's rule for a biped) | Network loss, crashed browser, wedged DO |
| `RobotSession` DO | **One writer at a time**, via a lease with a generation number. Priority: **e-stop > human teleop > AI**; a human taking the stick revokes the AI lease at once. The **e-stop is latched in DO storage**; only an owner-authenticated (passkey) "re-arm" clears it. Clamp and coalesce `move` at ≤20 Hz per writer. Refuse motion if the robot's heartbeat is stale or the last frame is older than 1 s | Two drivers interleaving (Microduck `remote-webrtc.md` §9), runaway clients, AI misbehaviour |
| Page | A STOP button on every view, also bound to Space/Escape and gamepad B, that sends `robot.stop` on its own. Shows who is driving. Stops sending on `visibilitychange`/`blur`/`gamepaddisconnected`. Shows frame age | Human error |
| Money | The robot's sub-grant caps and on-chain revoke (system 1) | Spend, whatever the software does |

- **Gamepad API caveat.** It works only in a **secure context** (HTTPS or localhost) and exposes a
  pad only after a button press ([Mozilla](https://hacks.mozilla.org/2020/07/securing-gamepad-api/)).
  Our workers.dev origin is fine, and `alchemy dev` on localhost is fine.
- **Latency.** Estimate 40–150 ms one way: browser, Cloudflare edge, DO in `apac`, robot. That is
  fine for a duck walking at 0.15 m/s; measure it (Uncertain).

### 3.4 What to reuse from Microduck

- **Patterns, not code, for our ODM:**
  - deadman and stop semantics (`robotd-design.md` §2.4);
  - continuous vs discrete intents (§3.1);
  - `requested`/`applied`/`limited_by` in state, so the UI can explain a clamp (§3.2);
  - the single-writer token (`remote-webrtc.md` §9).
- **The web console** (`mediad/webclient/index.html`, one file, no build) is a working reference for
  keys, pads, the 10 Hz resend and the explicit zero.
- **The sim's input layer** (`pollen-robotics_microduck-simulator/app/src/game/controls/controller.js`):
  a prioritised list of sources, where the first active one owns the twist. This is where a
  `RemoteSource` plugs in (section 6).
- **If the bench brain turns out to be a Microduck:** `robotd` already does all of the robot-side
  safety, `mediad` gives WebRTC, and our robot agent becomes a pipe. That is decision 8.1.

## 4. The robot as an MCP server for the AI client

### 4.1 Existing robot MCP servers

| Server | Robot | Tools (shape) | Camera | Safety | Take-away |
| --- | --- | --- | --- | --- | --- |
| [robotmcp/ros-mcp-server](https://github.com/robotmcp/ros-mcp-server) (1.5k★, Apache-2.0) | Any ROS 1/2 via rosbridge WS | Generic: `get_topics`, `publish_once`, `publish_for_durations(topic, msgs, durations, rate_hz)`, `subscribe_once`, services, actions, params | Image topics returned as MCP `ImageContent` JPEG (`ros_mcp/tools/images.py`) | None built in ("permissions" is listed as wanted) | Timed publishes are the useful idea. Too low-level and unsafe as our interface |
| Reachy Mini MCPs: [jackccrawford](https://github.com/jackccrawford/reachy-mini-mcp), [OriNachum](https://github.com/OriNachum/reachy-mini-mcp), [ArturSkowronski](https://github.com/ArturSkowronski/reachy-mini-mcp), [PixelML](https://github.com/PixelML/reachy-mini-mcp) | Reachy Mini (daemon REST on :8000) | `look(roll,pitch,yaw,z,duration)`, `snap`, `show(emotion)`, `speak`, `listen`, `rest`; or one `operate_robot(op, args)` | `snap`/`capture_image` returns a base64 JPEG | Durations, `stop_motion` | Small, intent-level verbs |
| Pollen [reachy_mini_conversation_app](https://github.com/pollen-robotics/reachy_mini_conversation_app) | Reachy Mini | Built-in local tools `move_head`, `camera(question)`, `dance`, `head_tracking`, … It **consumes** remote MCP tools from HF Spaces | `camera` returns `b64_im`. The app **strips it from the tool result** (`image_attached: true`) and **re-injects it as a user message with the image** (`huggingface_realtime.py:317,821`) | Robot tools stay local and trusted; remote tools need an allowlist in `tools.txt` ([HF blog](https://huggingface.co/blog/adding-mcp-tools-to-reachy-mini)) | This is how an OpenAI-style model sees a tool's picture |
| [lpigeon/unitree-go2-mcp-server](https://github.com/lpigeon/unitree-go2-mcp-server) | Go2 via ROS 2 | `pub_wirelesscontroller(linear_x, linear_y, yaw, pitch, keys, duration)`, gestures, `stop` | None | Velocity clamp (±3.7) | Velocity plus duration as one tool |
| [IliaLarchenko/robot_MCP](https://github.com/IliaLarchenko/robot_MCP) | SO-100/101 arm (LeRobot) | `get_robot_state`, `move_robot(...)`, `control_gripper`; **each move returns state plus images from all cameras** | MCP images | Its agent **keeps only the latest tool images** in context ("prevent token accumulation") | Act, then observe, in one call. Prune old images |
| [rokbenko/quackd](https://github.com/rokbenko/quackd) `serve-mcp` (Apache-2.0) | Microduck, **Open Duck Mini**, LeRobot, ROS bases (sim/mock; one arm on hardware) | `robot_list`, `robot_list_verbs`, `robot_assess_task` (a verdict gate before anything moves), `robot_run_verb` (`go_to`, `search_scan`, …), `robot_observe` (PNG + detections), `robot_say`, memory | `robot_observe` | An executor between LLM and body: allowlist, default **40 steps / 5 min** budget, confirm gates, heartbeat every 500 ms, kill switch, `stop` always exempt (`docs/guides/mcp.md`, `docs/concepts/safety.md`) | **The best design reference.** `go_to` is a local loop (look → 47 move intents → stop) that the LLM triggers once |
| [OpenMind/OM1](https://github.com/OpenMind/OM1) | Many (Go runtime) | OM1 is an **MCP client** (per-mode MCP servers for Slack, Maps, etc.). Robot actions are native plugins, not an MCP server (`docs/developing/mcp-integration.md`) | n/a | n/a | Not a server to copy |
| LeRobot | Arms | No official Hugging Face MCP server found. Community: robot_MCP, [phospho-mcp-server](https://github.com/phospho-app/phospho-mcp-server) (VLA runs) | | | None |

### 4.2 Where the MCP server lives

| Option | Pros | Cons | Verdict |
| --- | --- | --- | --- |
| **In our Worker**, with tool handlers as RPCs into `RobotSession`. Serve it from the wallet MCP's stack (`createMcpHandler` + MCP SDK v2 per `mcp-wallet-and-ai-client.md`; the edge Worker already routes `/mcp`) | NAT-proof: the robot is already connected outbound. One auth story: the same OAuth/grant model as the wallet MCP. Rate limits, e-stop latch and lease are enforced in one place, with the evidence log next to the 0G call. Real duck, sim and mock behave identically. Judges' MCP clients (Claude Code, etc.) can connect too | One extra hop (~tens of ms). If Effect's `McpServer` is used anyway: `registerToolkit` encodes results as JSON **text** only (`toolResultContent` in `McpServer.ts`). For `look`, register the tool with `McpServer.addTool` and return `CallToolResult({content:[{type:"image", data, mimeType:"image/jpeg"}, …]})` (`ImageContent` exists in `McpSchema.ts`). The MCP SDK returns `ImageContent` natively | **Recommended** |
| On the robot (Python FastMCP, as the ROS and Reachy servers do) | Lowest latency to the hardware; copyable examples | Unreachable from a remote AI behind venue NAT without a tunnel; a second auth surface; robot CPU and RAM; safety split across two places | Local dev only (Claude Code over SSH stdio) |
| A separate DO per MCP session (Agents SDK `McpAgent`) | Cloudflare-native | `McpAgent` is deprecated in favour of `createMcpHandler` (`mcp-wallet-and-ai-client.md`); it would still have to call `RobotSession` | No |

### 4.3 Tool set

Annotate them: `readOnlyHint` for status, look and scan; `destructiveHint` for move, approach and
pay. Every tool takes `robotId` (or binds one per URL, `/mcp/robots/{id}`). Every result carries
`frameId` and `decisionStep` for the evidence log.

| Tool | Args (bounded) | Returns | Gate / rate |
| --- | --- | --- | --- |
| `robot_status` | none | online, battery if known, mode (`idle`/`teleop`/`ai`/`estopped`), lease holder, last-frame age, odometry if any, **declared limits and what this body cannot do** (ODM: no fall detection, no stand-up, no battery report, per quackd) | Free |
| `look` | `maxSide` ≤ 640 | MCP `ImageContent` JPEG + text `{frameId, capturedAt, ageMs, sha256}` | ≤ 1/s. Error `stale_frame` if no frame newer than 1 s |
| `scan_qr` | `timeoutMs` ≤ 3000 | `{found, text, parsed: {chainId, to, amount, invoiceId, …}, quad, frameId, scanId}` via zxing-cpp on the robot (or zxing-wasm in the DO or sim). **Deterministic, not AI** | ≤ 1/s |
| `move` | `{forward_m: −0.3..0.5, turn_deg: −90..90}` *or* `{vx, vy, vyaw, duration_s ≤ 2}` | `{ok, applied, limitedBy, durationMs, frameIdAfter}`. Optionally a fresh image, so one call is act-then-look (robot_MCP pattern) | ≤ 1 per 2 s. The DO expands it into 10 Hz intents and then a zero. Refused while e-stopped, while a human holds the lease, or with a stale robot or frame |
| `approach_qr` | `{targetFraction: 0.1..0.5, timeoutS ≤ 20}` | `{ok, reason, finalQuad, frames}` | One skill run at a time. The visual-servo loop (yaw toward the QR centre, vx until the QR is big enough, then stop) runs **below** the AI: on the robot, or in the DO at about 5 Hz on DO frames. The AI triggers it and judges the outcome |
| `stop` | none | `{ok}` | Always allowed, never rate-limited, also exempt from budgets (quackd) |
| `pay_scanned_invoice` | `{scanId, maxAmount}` | `{status, userOpHash/txHash}` | The robot signs with **its own** narrower sub-grant **only an invoice it scanned itself** in the last ~60 s, and only with a recorded 0G decision for this step. An AI that is prompt-injected can't redirect funds to an address the camera never saw. Whether this tool lives here or in the wallet MCP is decision 8.3 |

Episode budget as in quackd: about 40 steps or 5 minutes per task, then `aborted` and stop. The
budget, the lease and the e-stop state come back on every result, so the model knows its limits.

### 4.4 Human safe-stop over the AI, and 0G unreachable

- **The AI never holds motion longer than its last decision.**
  - The AI lease has a TTL (e.g. 5 s). Only a tool call made inside a fresh agent step renews it
    (the agent loop stamps each MCP call with the 0G `request_id` of the step that produced it).
  - If 0G times out, returns 5xx, 402, `no_provider_for_trust_mode` or `tee_verified=false`, or
    returns malformed JSON (`0g.md` §6), no new tool call arrives. The lease lapses, the DO sends
    `robot.stop`, and the robot's deadman backs that up.
  - Bounded `move`s (≤ 2 s) mean the duck is never mid-command for long.
  - Nothing local decides `pay`. That is the prize rule satisfied by construction.
- **Human e-stop** (button or key, from any authenticated viewer):
  1. The DO latches `estopped`, revokes all leases and sends `robot.stop`.
  2. The robot latches.
  3. Every AI tool except `robot_status`/`stop` returns `{error: "estopped", by, at}`.
  4. Only the owner can re-arm, with the passkey.
- **Human teleop preempts the AI** the moment the stick moves, as the sim's `Controller` arbitrates
  (a pad beats a waypoint click). The AI sees `lease_lost: human`.
- **Rate limits:** a token bucket per robot in the DO (`move` 1 per 2 s, `look` 1/s, all tools
  60/min), returned as `{error: "rate_limited", retryAfterMs}`.

### 4.5 How the 0G vision model consumes frames

- The router takes images as `{"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,…"}}`
  in `messages[].content[]`: **base64, not URLs**, up to 20 MB per request (`0g.md` §2).
- **OpenAI-style tool messages can't carry an image**, so the AI client does what Pollen's app and
  robot_MCP do:
  1. Put `{image_attached: true, frameId, …}` in the `role: tool` message.
  2. Append a `role: user` message containing the image.
  3. Keep only the most recent one or two images in the context, and drop older ones.
- Use 640 px longest side, JPEG q≈70: roughly 40–80 KB of base64, a few hundred image tokens on
  Qwen- or GLM-class models (estimate). At most one frame per decision; never video.
- Give the model **parsed facts plus the picture**: `scan_qr`'s decoded payload, the owner policy and
  the frame. The decoder reads the money fields; the model judges "is this the item, is this sane"
  (`0g.md` §6 decision schema).
- **Models on the router right now.** At 18:41 UTC today `GET https://router-api.0g.ai/v1/models`
  listed **79 models and no `0gm-1.0-35b-a3b`**, which `0g.md` found earlier today among 124.
  Vision models that also list `tools`:
  - `glm-5.3-flash` ($0.09 / $0.32 per M tokens)
  - `qwen3.8-flash` (text, image and video)
  - `deepseek-v4-flash-vision-exp`
  - plus the closed models

  Make the model a config shortlist. If none of the shortlisted models is available, safe-stop.
  Don't fall back silently.
  `mcp-wallet-and-ai-client.md` §6.1 found at the same time that **every chatbot provider is
  `trust_mode: "standard"`** (no TeeML). `X-0G-Provider-Trust-Mode: private` would currently 503,
  so the sealed-inference claim in `0g.md` is on hold.
- **Latency.** Thinking-on vision calls are probably seconds long (Uncertain). That is why the AI
  issues bounded moves and skills, and never closes a steering loop itself.

## 5. 0G Physical-AI examples: how they wire 0G into a robot

| Repo (commit) | Robot link | 0G in the loop | Video to browser | Borrow |
| --- | --- | --- | --- | --- |
| `0gfoundation_zerobot` (c8328ad, last commit 2026-10-16) | Unitree Go2 over its built-in WebRTC, **LAN only**. The dashboard proxies SDP through `/api/negotiate` because the robot's signalling endpoint can't be reached cross-origin | `AIBroker.resolvePrompt` turns natural language into a fixed command vocabulary via the **Direct** broker (`qwen-2.5-7b-instruct` default, probably stale). Commands go **on chain** (`RobotCommandDispatcher`), and an `OperatorNode` executes them and submits receipts | No camera view. Hold-to-move resends every 500 ms (`use-robot-connection.ts`) | Command schema per robot type, operator key, receipts, mock robot. Not its architecture |
| `0gfoundation_project-floaty` (94f5ddc) | Desk bot → hub WebSocket, **only while someone watches** (+30 s), `X-Device` header, retry every 5 s; viewers on a separate WS; binary frames with a 1-byte source prefix (`PROTOCOL.md`) | 0G Private Computer for thinking; the brain and firmware are "soon" | Telemetry plus audio, no video | **The streaming-on-demand protocol shape for 2.2** |
| `0gfoundation_reachy-mini-hackathon` (ceec36d) | Pollen's JS SDK `reachy-mini.js` gives the browser the robot over WebRTC through the HF rendezvous ("auto-discovers the robot via the relay") | **The browser calls 0G directly** with per-provider `app-sk-` keys (older Direct-provider URLs) for chat and Whisper; vision suggested via `qwen3-vl` | Yes: the robot's WebRTC track in `remoteVideo`, and the robot's audio track for speech-to-text | `sim.js`: a three.js sim exposing **the same surface as the live SDK**, the pattern for section 6. Rubric: 0G integration /10, "8–10: 0G is essential" |
| Newer from 0G | None found on GitHub. The org's recent repos are infra (`0g-hack-box`, `0g-tapp`, `0g-kms`, …); the DevRel site mentions humanoid and robot-dog demos with no code | | | |

Our design keeps the 0G key on the backend (`0g.md` §6), unlike the hackathon starter, which
ships keys to the browser.

## 6. A virtual robot for iteration 1.5

| Option | Fidelity | Effort | Notes |
| --- | --- | --- | --- |
| **Fork the Microduck sandbox** ([HF Space](https://huggingface.co/spaces/pollen-robotics/microduck-simulator), cloned to `references/pollen-robotics_microduck-simulator`) into a browser "sim robot" | Real MuJoCo physics (`@mujoco/mujoco` 3.11, latest 3.17.0) plus the real walking policy (onnxruntime-web, 61-D obs, 50 Hz). Same velocity interface as the real duck | Estimate half a day to a day | Vite + React + three.js. Add: (1) a WS client to `RobotSession` that registers as a robot with `simulated: true`; (2) a `RemoteSource` at the top of `new Controller({sources: [...]})` (`game.js:517`) applying `robot.move` with its own 300 ms deadman; (3) a `PerspectiveCamera` attached to the head body, rendering at 5 fps to a render target, then `canvas.toBlob("image/jpeg", 0.7)`, then a WS binary frame; (4) a "merchant stand" plane textured with the live invoice QR; (5) `scan_qr` via `zxing-wasm`. Caveats: **meshes are CC BY-NC-SA 4.0** (`microduck_rl/LICENSE-MODELS.md`), fine for a demo but not for a product; LFS assets need `git lfs pull` (the clone skipped LFS); rAF pauses in background tabs (`game.js:2171` comment), so keep the tab visible; it is a Microduck, not our ODM, so label it honestly |
| quackd's `web/` demo (plain JS, no build, MuJoCo-WASM, fetches Pollen's model and policy at a pinned commit) | Same physics | Similar | `observe()` returns geometric detections, not pixels. Fewer features than the Space (no arena props or gamepad polish) |
| Microduck `scripts/duck-sim` (`robotd --sim` + `mediad --sim-camera` on a Linux box) | Highest for a Microduck: the real daemons and API, a rendered head camera | High: Rust build plus MuJoCo; camera rendering is "the scaling wall" (`docs/design/simulation.md`) | Only if we adopt Microduck's stack |
| Headless Bun mock robot | 2-D kinematic pose plus canned photos (QR in view or not) | 1–2 hours | For CI and story tests, and for exercising the lease, e-stop, deadman and rate limits without a GPU or a browser (zerobot ships a mock the same way) |
| An Open Duck Mini web sim | Would match our body | Port the `Open_Duck_Playground` MJCF plus `BEST_WALK_ONNX_2` and its different observation layout | Not worth it this weekend. "A Microduck ONNX file is not a drop-in Open Duck Mini policy" |

## 7. Recommended stack

**(a) Camera to browser**
- Default: UVC webcam (MJPEG) on USB-C 2. CSI IMX219 only if the connector checks out.
- A small capture process on the Radxa keeps only the newest frame.
- JPEG frames go over the robot's outbound WS to `RobotSession` (`locationHint: "apac"`), and on to
  viewers with one frame in flight each. The robot streams only while someone watches, and serves
  snapshots on demand for the AI.
- Stretch: go2rtc WebRTC signalled via the DO, with Cloudflare TURN for the browser.

**(b) Browser control**
- Foldkit page: Gamepad API and keyboard, 10 Hz `robot.move` with `seq`, explicit zero on release, a
  STOP button that is always visible, and the frame age on screen.
- `RobotSession`: lease with generations (e-stop > human > AI), a latched e-stop with owner re-arm,
  clamps and coalescing.
- Robot: an ODM adapter on quackd's `NetworkController` pattern, with an in-loop 300 ms deadman,
  clamps at ±0.15/±0.2/±1.0 and a stop latch. Plus the power switch.

**(c) Robot MCP**
- Served in our Worker at `/mcp/robots/{id}`, on the same MCP stack and OAuth as the wallet MCP, with
  handlers as `RobotSession` RPCs.
- Tools `robot_status`, `look` (`ImageContent`), `scan_qr`, `move` (≤ 2 s), `approach_qr`, `stop`,
  and `pay_scanned_invoice` (pending decision 8.3).
- Limits: AI lease TTL renewed only by fresh 0G steps; token buckets; a 40-step / 5-minute episode
  budget; evidence (`request_id`, frame sha256) on every step.
- The AI client strips images from tool messages, re-injects the latest one as a user image, and
  picks its model from a shortlist.

**(d) Virtual robot**
- A fork of the Microduck MuJoCo-WASM sandbox as a sim robot speaking the same WS protocol:
  `RemoteSource`, head-camera JPEGs, a QR stand, zxing-wasm.
- The Bun mock for tests.
- The dashboard, teleop, MCP tools and the 0G loop get built and demoed against it before the duck
  walks.

## 8. Confidence table

| Item | Status | Note / next step |
| --- | --- | --- |
| Microduck `mediad`: hardware H.264 WebRTC at 29.3 fps 720p, about 25% of one core; needs gst-plugins-rs and the `mpph264enc` level fix; Cloudflare TURN relay proven | **Known** | `remote-webrtc.md` §0, `remote-access-design.md` §6 |
| Microduck `robot.move` semantics, deadman 500 ms, console at 10 Hz plus explicit zero, pad limits | **Known** | `robotd-design.md` §2.4/§3, `deploy/robotd.toml`, `mediad/webclient/index.html` |
| ODM runtime: 7-float command, 20 Hz pad thread, ranges ±0.15/±0.2/±1.0, no deadman, no network API, no fall or battery reporting | **Known** | `xbox_controller.py`, quackd `docs/adapters/open_duck/README.md` |
| quackd ODM bridge pattern (rebind `XBoxController`, in-loop deadman, separate camera daemon) | **Known** (never run on a physical duck, by its author's own statement) | Our servos and policy differ, so the bridge is a pattern, not a drop-in |
| Cloudflare: WS messages up to 32 MiB received; 20:1 incoming billing; TURN/SFU 1,000 GB/month free; TURN credentials API; WS adapter is JPEG egress at 1 fps by default, no video ingest | **Known** | Links in section 10 |
| go2rtc: native v4l2, MJPEG/H.264 passthrough, rkmpp via ffmpeg-rockchip tested on an RK3566 board, WHEP-like API, publish is RTMP only | **Known** (docs) | |
| Effect 4.0.7 `McpServer` (streamable HTTP); toolkit results are JSON text only, images need `addTool` | **Known** (source) | Moot if the wallet MCP's `createMcpHandler` stack is used, as `mcp-wallet-and-ai-client.md` recommends |
| Image re-injection as a user message; prune old images | **Known** (two codebases) | |
| Gamepad API needs a secure context and a button press | **Known** | |
| 0G router: vision models with tools available now; `0gm-1.0` absent from the list at 18:41 UTC | **Known** (live check) | Recheck before the demo; ask at the 0G booth |
| JPEG-over-DO latency, fps and stability on venue Wi-Fi; DO placement from Mumbai with `apac` | **Uncertain: spike** | Measure glass to glass with a stopwatch overlay in the first hour |
| JPEG encode CPU on RK3566 for the CSI path; does the CSI camera work at all on this board | **Uncertain: spike** | Bench checklist in `robots-and-embedded.md` §2; else UVC |
| Whether our UVC webcam offers MJPEG 640×480 at ≥15 fps (or H.264) | **Uncertain: spike** | `v4l2-ctl --list-formats-ext` |
| go2rtc + ffmpeg-rockchip on the OS image Kris runs; the H.264 level/profile negotiation in browsers | **Uncertain: spike** | Stretch only |
| Sim fork: head-camera render cost, `toBlob` at 5 fps, zxing-wasm reading a rendered QR | **Uncertain: spike** | |
| zxing-wasm inside a Worker (static WASM import, CPU per frame) if `approach_qr` runs in the DO | **Uncertain: spike** | Else run the skill on the robot (zxing-cpp) |
| 0G vision-call latency with an image (thinking on) | **Uncertain: spike** | Drives the AI step cadence and the lease TTL |
| Walking policy on Kris's modified servos | **Uncertain: spike** | `decisions.md` open item |
| 8.1 Which OS and stack is on the Radxa (Radxa OS, Armbian vendor 6.1, or Pollen's image); is the bench brain a Microduck | **Unknown: decision** | Decides MPP availability and whether `robotd`/`mediad` are reusable |
| 8.2 Where the AI client runs and who holds the 0G key | **Unknown: decision** | `mcp-wallet-and-ai-client.md` proposes an Agents SDK `Agent` (a DO) whose `MCPClientManager` connects to wallet, merchant and robot MCP. That fits the lease-renewal design in 4.4. Key never in the browser |
| 8.3 Does the robot sign its own payments (`pay_scanned_invoice` on the robot MCP) or does the AI pay via the wallet MCP | **Unknown: decision** | Proposal: robot signs only what it scanned, under its sub-grant |
| 8.4 Who may watch and who may drive: owner only, or a judge share link with a view or drive lease | **Unknown: decision** | Affects auth on the viewer WS |
| 8.5 Is CC BY-NC-SA on the Microduck meshes acceptable for the public demo and repo | **Unknown: decision** | Don't commit the meshes; fetch them at runtime as quackd does |
| 8.6 Fall handling on ODM (none upstream): is a human spotter enough for the demo | **Unknown: decision** | quackd: "You are the fall detector" |

## 9. Cloned repos (this task)

All in `references/`, `GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1`, cloned 2026-11-05. Not added to
`references/README.md`.

| Path | URL | Commit | Size | Why |
| --- | --- | --- | --- | --- |
| `references/pollen-robotics_microduck-simulator` | https://huggingface.co/spaces/pollen-robotics/microduck-simulator | `ad9d41a` | 2.2 MB (LFS skipped) | MuJoCo-WASM + ONNX browser sim to fork as the virtual robot. `app/src/game/controls/controller.js` (source arbitration), `waypoint.js` (click to go), `game.js` (`window.rl` hooks) |
| `references/rokbenko_quackd` | https://github.com/rokbenko/quackd | `64876bf` | 59 MB | LLM brain plus `serve-mcp` for Microduck and ODM. `docs/guides/mcp.md`, `docs/concepts/safety.md`, `bridge/open_duck/quackd_duck_bridge.py` (deadman), `quackd_duck_camd.py`, `web/` |
| `references/cloudflare_realtime-examples` | https://github.com/cloudflare/realtime-examples | `53489c2` | 33 MB | SFU/TURN blueprints: `video-to-jpeg/` (SFU → Worker JPEG), `cloud-gaming/` (publisher + DO controller generations + DataChannel input), `whip-whep-server/`, `esp32-radio/` |
| `references/AlexxIT_go2rtc` | https://github.com/AlexxIT/go2rtc | `990f4de` | 5.9 MB | WebRTC upgrade path: `internal/v4l2/README.md`, `internal/ffmpeg/hardware/README.md` (rkmpp), `internal/webrtc/README.md` |
| `references/robotmcp_ros-mcp-server` | https://github.com/robotmcp/ros-mcp-server | `476591a` | 180 MB (demo media) | The most popular robot MCP: generic tools, `ImageContent` images (`ros_mcp/tools/images.py`, `topics.py` `publish_for_durations`) |
| `references/pollen-robotics_reachy_mini` | https://github.com/pollen-robotics/reachy_mini | `25756e7` | 16 MB | Robot media server (`webrtcsink` + IPC frames), central rendezvous consumer, TS SDK, `skills/ai-integration.md` ("LLM decides → tool call → queue move → control loop") |
| `references/pollen-robotics_reachy_mini_conversation_app` | https://github.com/pollen-robotics/reachy_mini_conversation_app | `e901925` | 3.3 MB | Robot tools for an LLM; camera image re-injection (`tools/camera.py`, `huggingface_realtime.py`) |
| `references/IliaLarchenko_robot_MCP` | https://github.com/IliaLarchenko/robot_MCP | `5087718` | 0.6 MB | Act-then-observe tools, multi-LLM agent that prunes images (`mcp_robot_server.py`, `agent.py`, `llm_providers/openai_provider.py`) |
| `references/jackccrawford_reachy-mini-mcp` | https://github.com/jackccrawford/reachy-mini-mcp | `0ad7fc8` | 1.2 MB | Minimal intent-level MCP (`look`, `snap`, `show`, `rest`) in `src/server.py` |
| `references/lpigeon_unitree-go2-mcp-server` | https://github.com/lpigeon/unitree-go2-mcp-server | `e7a6737` | 170 MB (media) | Velocity-plus-duration tool and gesture tools for a legged robot (`server.py`) |

Existing clones read for this note: `pollen-robotics_microduck` (`c15c237`), `pollen-robotics_microduck_rl`
(`bae39f5`), `apirrone_Open_Duck_Mini_Runtime` (`376de65`), `0gfoundation_zerobot` (`c8328ad`),
`0gfoundation_project-floaty` (`94f5ddc`), `0gfoundation_reachy-mini-hackathon` (`ceec36d`),
`OpenMind_OM1` (`2102a49`).

Not cloned:
- `bluenviron/mediamtx`, `aiortc/aiortc`, `cloudflare/agents` and `livekit/*`: not on the
  recommended path, so their docs are enough.
- `google-deepmind/mujoco`: very large; the npm `@mujoco/mujoco` package is what matters.
- `pollen-robotics/reachy_mini_central`: not found on GitHub; it is an HF Space.

## 10. Sources

Local (read in source):

- Microduck `docs/design/remote-webrtc.md`, `docs/design/remote-access-design.md`
- Microduck `docs/project/media-bringup.md`, `docs/design/robotd-design.md`, `docs/design/simulation.md`
- Microduck `deploy/robotd.toml`, `mediad/src/stream.rs`, `mediad/src/route.rs`, `mediad/webclient/index.html`, `netpadd/src/main.rs`
- `Open_Duck_Mini_Runtime/mini_bdx_runtime/xbox_controller.py`, `scripts/v2_rl_walk_mujoco.py`
- `node_modules/effect/src/ai/McpServer.ts` and `McpSchema.ts` (Effect 4.0.7)
- the repos in section 9

Web:

- Pollen Microduck: https://github.com/pollen-robotics/microduck · sandbox: https://huggingface.co/spaces/pollen-robotics/microduck-simulator · mesh licence: https://github.com/pollen-robotics/microduck_rl/blob/main/LICENSE-MODELS.md
- mpph264enc WebRTC fix: https://github.com/JeffyCN/mirrors/pull/83
- go2rtc: https://github.com/AlexxIT/go2rtc · hardware: https://github.com/AlexxIT/go2rtc/blob/master/internal/ffmpeg/hardware/README.md · Rockchip presets issue: https://github.com/AlexxIT/go2rtc/issues/768
- ffmpeg-rockchip: https://github.com/nyanmisaka/ffmpeg-rockchip · builds: https://github.com/MarcA711/Rockchip-FFmpeg-Builds/releases/
- Radxa RTSP/MPP guide (RK3588): https://docs.radxa.com/en/rock5/rock5b/app-development/rtsp · Jellyfin RKMPP: https://jellyfin.org/docs/general/post-install/transcoding/hardware-acceleration/rockchip/ · Frigate RK3566 decode issue: https://github.com/blakeblackshear/frigate/discussions/9952
- MediaMTX: https://github.com/bluenviron/mediamtx · aiortc: https://github.com/aiortc/aiortc
- Cloudflare Realtime pricing: https://developers.cloudflare.com/realtime/sfu/platform/pricing/ · limits: https://developers.cloudflare.com/realtime/sfu/platform/limits/ · WebSocket adapter: https://developers.cloudflare.com/realtime/sfu/features/media-transport-adapters/websocket-adapter/ · TURN credentials: https://developers.cloudflare.com/realtime/turn/generate-credentials/ · TURN FAQ: https://developers.cloudflare.com/realtime/turn/faq/ · examples: https://github.com/cloudflare/realtime-examples
- Durable Objects limits: https://developers.cloudflare.com/durable-objects/platform/limits/ · data location: https://developers.cloudflare.com/durable-objects/reference/data-location/ · release notes (20:1): https://developers.cloudflare.com/durable-objects/release-notes/ · 32 MiB change: https://developers.cloudflare.com/changelog/post/2025-10-31-increased-websocket-message-size-limit/
- LiveKit pricing (third party): https://micdrop.dev/blog/livekit-pricing · https://agentdeals.dev/vendor/livekit
- Gamepad API secure context: https://hacks.mozilla.org/2020/07/securing-gamepad-api/ · https://www.xda-developers.com/chrome-gamepad-api-changes/
- Robot MCP servers:
  - ROS: https://github.com/robotmcp/ros-mcp-server
  - Reachy Mini: https://github.com/jackccrawford/reachy-mini-mcp · https://github.com/OriNachum/reachy-mini-mcp · https://github.com/ArturSkowronski/reachy-mini-mcp · https://github.com/PixelML/reachy-mini-mcp
  - Pollen's MCP blog post: https://huggingface.co/blog/adding-mcp-tools-to-reachy-mini · conversation app: https://github.com/pollen-robotics/reachy_mini_conversation_app
  - Unitree Go2: https://github.com/lpigeon/unitree-go2-mcp-server · https://github.com/sandraschi/unitree-mcp
  - LeRobot/SO-100: https://github.com/IliaLarchenko/robot_MCP · https://github.com/phospho-app/phospho-mcp-server
  - OM1 MCP: https://github.com/OpenMind/OM1/blob/main/docs/developing/mcp-integration.md
- quackd: https://github.com/rokbenko/quackd · https://www.quackd.org/simulator
- 0G: https://router-api.0g.ai/v1/models (live, 2026-11-05 18:41 UTC) · https://github.com/0gfoundation/zerobot · https://github.com/0gfoundation/project-floaty · https://github.com/0gfoundation/reachy-mini-hackathon · https://itsgathin.com/
- MuJoCo WASM: https://www.npmjs.com/package/@mujoco/mujoco · zxing-wasm: https://github.com/Sec-ant/zxing-wasm
