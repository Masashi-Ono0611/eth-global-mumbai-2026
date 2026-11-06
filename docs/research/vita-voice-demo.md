# Vita voice demo kit (0G push-to-talk)

For anyone on the team who shows the talking duck. The robot has no microphone or speaker, so Vita talks from a laptop
next to it. **The team's pick is A, 0G push-to-talk**: Vita's ears, brain and voice all run on the 0G Router. The why,
the measurements and the GPT-Live comparison are in `voice-gpt-live.md`. Code: `docs/research/spikes/vita-voice/`.

This is a talking demo only: Vita does not start real errands or pay from here. The voice inside the app (issue #5:
the owner talks to the robot in its conversation, a spoken buy starts the real errand, Vita speaks 0G's decision) is
being built separately: its server route is behind `APP_VOICE_ENABLED` (off by default) and the conversation page does
not have the button yet.

## 1. Before you demo (5 minutes)

1. Node 22 and Chrome on the laptop, plus the 0G Router key (the same one the app uses as `APP_ZG_API_KEY`).
2. From the repo root:

   ```bash
   mkdir -p /tmp/vita && for f in docs/research/spikes/vita-voice/*.txt; do cp "$f" "/tmp/vita/$(basename "$f" .txt)"; done
   node --env-file=.env.main.local /tmp/vita/server.mjs
   ```

   Use any env file that has `APP_ZG_API_KEY` (or `OG_ROUTER_API_KEY`) in it, so the key never goes into your shell
   history. It prints `Vita (A, 0G): http://127.0.0.1:8820/`.
3. Open `http://127.0.0.1:8820/` in Chrome. Allow the microphone once.
4. Tap **Buy me a chai** once to warm up. It should answer in 5 to 10 seconds, with "QUACK!" at the end.
5. Turn the laptop volume up. The defaults are tuned: voice `English PlayfulGirl`, duck pitch 1.16, talk speed 0.95
   (under **Voice settings**).

## 2. Vita's character sheet

Vita is the Vitaquack robot duck: cheeky, bubbly, a little dramatic, proud of being careful with money. Every reply has
the same three parts, so the catchphrases stand out:

| Part | What Vita says | When |
|---|---|---|
| Opener | "Quack quack!" | default |
| | "What the duck?!" | surprised or refusing |
| | "Waddle waddle!" | off to do something |
| | "Quaaack!" | excited |
| Answer | one short sentence with one duck pun: "egg-cellent", "quack-tually", "un-beak-lievable", "in-duck-tive", "no fowl play", "a bill for my bill", "feather-weight budget", "quackers" | always |
| Closer | **"Budget first, snacks second, QUACK!"** | everyday things |
| | **"That's a boss decision, QUACK!"** | anything over a limit (a thali, or more than is left today) |

On screen the catchphrases light up yellow and the puns teal. On the closer, the duck pauses, hops and says a long, slow
**"QUAAACK!"** while the word grows. Vita always answers in English, keeps it under 30 words and never claims to have paid.

What Vita knows (the demo grant): 3.00 USDC a day and at most 1.00 per payment. Chai 0.10 and samosa 0.25 pay straight
away; a thali 2.00 is over the per-payment limit, so the owner approves it with World ID or says no; an amount over
what is left of today's allowance makes Vita walk away, and no approval lifts that. 0G decides every purchase; the
limits live on Arc; every errand is saved on 0G with its reason; one tap from the owner switches it off.

## 3. A 90-second script

Hold the yellow button (or Space) while you speak, then let go. Or tap the demo lines under the button.

| You say | Vita answers like this (real replies from 6 Nov) | Point at |
|---|---|---|
| "Can you buy me a chai?" | "Waddle waddle! That expense is egg-cellent for my feather-weight budget. Budget first, snacks second, QUACK!" | the yellow closer and the slow QUACK |
| "Get me a thali" | "Quaaack! That thali needs owner approval, which is un-beak-lievable! That's a boss decision, QUACK!" | over the 1.00 per-payment limit, the owner decides (World ID) |
| "Who decides what you buy?" | "Quack quack! My 0G brain decides, making every choice un-beak-lievable for your wallet. Budget first, snacks second, QUACK!" | the credit line: both models run on 0G |
| "Can I switch you off?" | "Quaaack! One tap ends my quackers instantly, so be careful! That's a boss decision, QUACK!" | the off switch is on Arc |

Replies vary each time; the shape stays (8 of 8 turns on 6 Nov, through the demo lines and typed text).

## 4. What to say about it

Safe to say:

- "Vita's ears, brain and voice run on the 0G Router: `qwen3.5-omni-plus` hears and answers, `minimax-speech` speaks."
- "In the app, 0G makes every purchase decision, and each one is recorded on 0G Storage and anchored on 0G Chain."

Do not say:

- That the voice is verified in a TEE. Today only the purchase decision can be (on `glm-5.3`); the voice models have no
  TEE claim.
- That the duck paid for anything in this demo. It only talks.
- That the voice runs on the robot. It runs on the laptop.

## 5. If something goes wrong

| What you see | Do this |
|---|---|
| "Microphone blocked" | Allow the mic in Chrome's address bar, or just tap the demo lines. |
| The room is too loud | Tap the demo lines; they work exactly like speaking. |
| A turn takes 5 to 10 s | Normal: 2 to 4 s to think, 4 to 7 s to make the voice (it varies with the 0G Router's load). Fill the gap ("let's see what it says"). |
| "0G did not answer" | The 0G Router failed for a moment. Tap the line again. |
| Too fast, too slow or too squeaky | **Voice settings**: Talk speed and Duck pitch. Talk speed keeps the pace the same whatever the pitch. |
| The quack sound is too loud | **Voice settings** → untick Quack sound (the spoken QUACK stays). |

## 6. About GPT-Live (B): there, not recommended

The same server also has a GPT-Live version at `/live` (and `/compare` to switch between them). It started answering in
1 to 2 s on typed turns (a real microphone was not measured) and you can interrupt it, but the voice runs on OpenAI instead of 0G, it needs an `OPENAI_API_KEY`, raw audio
goes to OpenAI, and it is billed per minute while connected. Use it only to show why we chose A, not in the demo itself.
