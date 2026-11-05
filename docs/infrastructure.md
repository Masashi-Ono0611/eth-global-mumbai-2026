# Infrastructure brainstorm (Cloudflare)

> **Updated for plan v3 (2026-11-05).** `RobotSession` became the **Robot Agent** (one DO per robot, also the AI
> client: 0G, wallet MCP, chip WebSocket). The `Relayer` is our **x402 facilitator / relayer** (grant payments and
> owner actions); **Circle's Facilitator Service** settles float payments. See `docs/plan.md` §2 and `decisions.md`.
> The picture below is the v1 sketch; the architecture page has the current diagrams.

Status: **brainstorm for the team, nothing built yet.** Written 2026-11-05. It builds on
`decisions.md` and the notes in `docs/research/`. Where this conflicts with `decisions.md`,
`decisions.md` wins.

## The one rule that shapes everything

**Arc is the authority; Cloudflare coordinates.** Caps, revokes and human approvals are enforced by
the owner's 7702 account on Arc. Everything on Cloudflare is either:

- a **convenience** (relaying, caching, UI, notifications), or
- a **co-signer that can only say no**: the World approver signs a payment only after a valid World
  approval. It can't spend on its own, and the on-chain caps still apply.

If Cloudflare disappears, no robot can spend more than its on-chain allowance. At worst it can't pay
at all.

## Picture

```
                         ┌───────────────────── Cloudflare (one origin, deployed by Alchemy) ──────────────────────┐
 Owner (phone/laptop) ──▶│ Worker: web (Foldkit SSR) + API + auth                                                  │
  passkey / 7702 EOA     │                                                                                         │
                         │  Durable Objects                                     D1 (read models, not authority)    │
 Robot runtime ◀═ws══════╪═▶ RobotSession   one per robot: live socket, state,   owners, robots, policies (mirror),│
  (sim / Radxa / duck)   │                  safe-stop, current decision          merchants, invoices, ledger,       │
                         │    Invoice       one per invoice: status, expiry,     decision log index                 │
 Merchant gate ◀═ws/poll═╪═▶                pushes signed "paid" to the gate                                        │
  (web page / ESP32)     │    Approval      one per approval: World device flow, R2                                 │
                         │                  alarm-driven polling, 20-min expiry  camera frames, 0G request/response │
 World IdP ◀─────────────┤    Relayer       ONE: owns the relayer key + nonce,   bodies, evidence bundles           │
 (auth.world.org)        │                  submits to Arc, fee ≥ 20 gwei                                           │
                         │    ChainWatcher  ONE: follows Arc blocks (~0.5 s),    Queues                             │
 Arc RPC ◀───────────────┤                  marks invoices paid from logs        evidence uploads, notifications    │
 0G router (inference) ◀─┤    (Decision calls to 0G go from the Worker)          Cron: expire invoices, reconcile   │
                         └─────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                                   │ Queue consumer (Node needed)
                                                    Evidence uploader: 0G Storage SDK + 0G Chain log contract
                                                    (Cloudflare Container, or a small Node/Bun box)
```

## Pieces and why each is shaped that way

### Worker (single origin)
- Same topology as the styldappv2 foundation: one public origin serving pages, API and auth, deployed by
  Alchemy, using Effect services.
- Owner auth: passkey. `yielded-dev/auth` has a passkey package. Alternatively, Sign-In-With-Ethereum
  with the 7702 EOA.
- Robots authenticate by **signing with their session key** (a challenge or signed requests). The
  robot's key is its identity, so no robot passwords or API tokens are needed.

### Durable Objects: one writer per thing that must not race

| DO | Instances | Why a DO |
| --- | --- | --- |
| `RobotAgent` (v3; was `RobotSession`) | one per robot | **The robot's AI client**: Agents SDK `Agent` running the pi-ai loop against 0G, holding the wallet MCP OAuth connection, logging every decision. Also holds the chip's WebSocket (chips sit behind NAT, so they connect out): pairing, sign requests to the chip, camera frames, movement with a 300 ms deadman and owner e-stop. Runs with no chip. Hibernation keeps idle robots cheap |
| `Invoice` | one per invoice | Single-writer status machine `pending → paid → used`, or `→ expired`. Pushes a **server-signed** (Ed25519) status to the gate, which holds only the public key. Idempotent payment endpoint |
| `Approval` | one per approval | The World device flow: start, show the code, then poll the token endpoint with an **alarm** at `interval` (+5 s on `slow_down`). Hard stop at 20 min. Approved → the approver key signs `{paymentIntentHash, expiry}`. Denied, expired or an outage → nothing is signed, so the payment can't happen |
| `Relayer` = our **x402 facilitator** (v3) | **one** | Settles grant payments (exact / ERC-7710 → `redeemDelegations`) and owner actions (passkey-signed one-time delegations). Float payments (EIP-3009) go to **Circle's Facilitator Service** instead. The relayer EOA's nonce must be serialised, and one DO is a natural lock. Builds transactions with `maxFeePerGas ≥ 20 gwei` (lower is silently dropped on Arc), retries, records tx hashes. Pays gas in USDC, so users never see gas |
| `ChainWatcher` | **one** (v3: reconcile only; x402 settle already returns the receipt) | Follows Arc logs (alarm every ~1 s, or a WebSocket subscription if the RPC supports it), matches payments to invoices, and writes `paid` into the `Invoice` DO. Native USDC also emits `Transfer` logs (EIP-7708), so de-duplicate against the ERC-20 events |

### D1: read models only
- owners, robots (address, label, body type), policies (**a mirror** of on-chain delegations for display),
  merchants, invoices, a payments ledger, and the decision log index.
- **Never read D1 to decide whether a payment is allowed.** That question goes to Arc.

### R2
- Camera frames, 0G request/response bodies, and evidence bundles before they're uploaded to 0G Storage.
- Short retention for raw frames; keep hashes forever.

### Queues and cron
- Queue: `evidence.upload`, consumed by the Node uploader. Also notifications to the owner's phone.
- Cron: expire stale invoices and approvals, and reconcile D1 against chain state.

### What can't run in a Worker
- **0G Storage SDK:** needs Node `fs`/`crypto` and pins `ethers@6.13.1`. Options:
  - **Cloudflare Containers** (stays inside Cloudflare, deployed with everything else). Need to check
    Alchemy support.
  - A tiny Node/Bun service elsewhere, fed by the queue over HTTP.
- **0G inference** is OpenAI-compatible HTTP, so plain `fetch` from the Worker works.

## Secrets and keys

| Key | Lives | Can do | Blast radius if stolen |
| --- | --- | --- | --- |
| Robot session key | on the robot only | sign payments within its on-chain delegation | up to that robot's remaining cap. Owner revokes |
| Owner key / passkey | owner's device | everything | the owner's account. Never on our servers |
| Relayer key | Worker secret (Secrets Store) | submit txs, pay gas | its small USDC gas float. **It can't move owner funds** |
| World approver key | Worker secret, ideally a **separate Worker** with no other routes | co-sign approvals | it can approve, but every payment still needs the robot's signature and stays within the caps |
| Gate status key (Ed25519) | Worker secret | sign "paid" for gates | could open gates without payment. Physical risk only, no money risk |
| World client secret, 0G API key, RPC keys | Worker secrets | API access | rate limits and billing |

Open idea: split the approver into its own Worker or account so a bug in the main API can't reach it.

## Main flows on this infrastructure

1. **Pair a robot.** The robot generates its key and shows a pairing QR (address + nonce). The owner
   scans it. The owner signs a delegation (daily cap, expiry, revoke) with their 7702 account. The
   robot's `RobotSession` goes live.
2. **Pay (online).**
   1. The gate asks for an invoice: `Invoice` DO, QR on screen.
   2. The robot scans it and asks for a decision: Worker → **0G** (request id logged, evidence → R2 → queue).
   3. The robot signs a one-time payment delegation and sends it to the `Relayer`, which submits it to **Arc**.
   4. `ChainWatcher` sees the transfer, the `Invoice` flips to `paid`, and the gate gets a signed status and opens.
3. **Needs a human.** Over the per-payment cap or a restricted merchant: an `Approval` DO starts the **World**
   device flow and the owner sees the item and amount on our page. Approve → approver co-signature → pay as
   above. Deny or expiry → nothing is signed, and the gate never opens.
4. **Offline robot.** The robot signs the payment delegation with no network. The gate or another robot
   relays it later. The caps are checked when it lands, so a late payment past the cap reverts.
5. **Revoke / safe-stop.** Revoke is an on-chain `disableDelegation`. Safe-stop is a `RobotSession`
   message, and the robot stops moving and refuses to sign.

## Environments

- `local`: `alchemy dev`, sim robot, web gate. Arc **mainnet** with tiny caps; there is no testnet in
  our story. A local Arc fork (anvil) for contract tests.
- `preview`: workers.dev, the team's shared stage.
- No production stage for the event. Custom domain later.

## Open questions for the team

1. Should 0G calls go **through our Worker** (central evidence, one key) or **straight from the robot**
   (the robot's own key and request ids)? Proposal: through the Worker. The robot sends the frame and
   QR; the Worker calls 0G, logs and replies.
2. Should the ChainWatcher poll or subscribe? It depends on whether Arc's RPC offers `eth_subscribe` to Workers.
3. Run the evidence uploader in Cloudflare Containers or elsewhere?
4. Is a dedicated World approver Worker worth it now, or is a separate secret in the same Worker enough
   for the event?
5. Should gates use WebSocket (instant) or polling (simpler on ESP32)? Proposal: polling with a signed
   response first, WebSocket later.
6. Should the relayer's USDC gas float be funded from the owner (charged per payment) or from us (free for users)?
