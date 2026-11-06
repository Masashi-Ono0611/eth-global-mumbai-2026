---
version: alpha
name: Vitaquack wallet
description: The owner's passkey wallet, where each robot is a conversation. Direction "Quack chat", chosen by Kris on 6 Nov 2026 from docs/site/wallet-mocks/c.html. The tokens are the @theme names in apps/web/src/styles.css.
colors:
  paper: '#e7f1f6'
  surface: '#ffffff'
  ink: '#1f2d36'
  muted: '#5b6b75'
  rule: '#d3e2ea'
  duck: '#ffe07a'
  duck-deep: '#6b5200'
  online: '#23b064'
  paid: '#1b8550'
  error: '#b9433a'
  error-soft: '#fbe9e7'
  focus: '#2f6fb3'
typography:
  sans:
    fontFamily: Mukta
    fontSize: 16.5px
    lineHeight: 1.4
    fontWeight: 400
  display:
    fontFamily: Baloo 2
    fontWeight: 700
  amount:
    fontFamily: Baloo 2
    fontSize: 64px
    lineHeight: 0.95
    fontWeight: 800
    letterSpacing: -0.02em
rounded:
  control: 15px
  bubble: 20px
  card: 22px
  sheet: 30px
  pill: 999px
components:
  bubble-owner:
    backgroundColor: '{colors.ink}'
    textColor: '{colors.surface}'
    rounded: '{rounded.bubble}'
  bubble-robot:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.bubble}'
  bubble-asks:
    backgroundColor: '{colors.duck}'
    textColor: '{colors.ink}'
    rounded: '{rounded.bubble}'
  button-approve:
    backgroundColor: '#000000'
    textColor: '{colors.surface}'
    rounded: '{rounded.control}'
---

## Overview

Vitaquack is a passkey wallet on Arc that gives robots a USDC budget. The wallet is for the robot's owner, not for
crypto users: it says what happened in plain words, and the proof (Arc transactions, 0G request ids, 0G Storage
records) stays one tap away behind "Show proof". Each robot is a conversation. The owner asks for something, the robot
reports each step back as a message, and when it needs the owner it asks inside the message with the buttons there.
Light only, phone first.

## Colors

Paper is the page; white surfaces carry content. Ink is the owner's voice (their bubbles, primary buttons) and the
default text. Duck yellow means the robot needs the owner (an approval, the "needs you" card, a badge) or that Vita's
voice is live: the mic while it is open, the ring of Vita's spoken bubble and its catchphrases. It is never used for
decoration. Paid green marks money that moved; error red marks a refusal, a failure or Stop.
Approve with World ID is black, matching World's own sign-in button.

## Typography

Baloo 2 sets amounts, headings and robot names; Mukta sets everything else. Both come from Ek Type and cover
Devanagari. Numbers that change (balances, amounts, countdowns) use tabular figures.

## Layout

One centred column at phone width, also on a desktop. Home reads top to bottom: balance, the action pills (Send,
Receive, Robot), "Needs you", robots, payments. A robot's page is its thread: header, messages oldest to newest, and
the dock at the bottom like a chat app's: one row of Get me pills over the composer. The dock is solid paper with a
short fade above it, so the thread never shows through its controls.

## Shapes

Bubbles use the bubble radius with the corner nearest the speaker tightened, so it is clear who spoke. Cards and
lists use the card radius, bottom sheets the sheet radius, buttons the control radius, and pills are fully round.

## Components

- Owner bubble: right-aligned, ink. It holds what the owner asked for ("Get me a chai").
- Robot bubble: left-aligned, white. It is written from the errand's real state. 0G's reason is quoted word for
  word under a rule. The invoice QR is drawn from the invoice URL and is never presented as a camera frame.
- Asking bubble: duck yellow, with Approve with World ID and No inside it. It is used only for an approval that
  is waiting.
- Receipt: inside a robot bubble. Paid amount in the amount face, a paid check, "Show proof" and a muted "On Arc",
  then one quiet status line ("Saved on 0G" with a check, or "Saving to 0G..."). The 0G Storage, EpisodeLog and
  frame links live on the errand's page behind Show proof, never in the thread.
- Proof pages (`/app/proofs`, public): the errand page's audit cards and buttons (`EpisodeParts.ts`), showing only
  what is already public on 0G.
- System pill: centred and muted, for events that are not anyone's words ("Duck connected at 15:56").
- Empty conversation: the duck itself in the middle, in the same face as its home row (ink while its chip is on, grey
  and asleep while it is off), with one short line. Without an allowance the line says to give one first, with the
  button that opens the allowance sheet.
- Walking: "On my way to scan the QR at the counter" is the duck's own bubble, with Stop under it; it goes once the
  robot has scanned. The thread opens at its newest message and scrolls there whenever the intent or errand moves.
- A robot's photo that cannot be shown: a quiet camera in its box (`.photo-frame`), never the browser's alt text.
- Get me pills: one fully round pill per catalogue item ("Get me a chai" and its price, quiet, "0.10 USDC") in a single
  row that scrolls sideways. A pill sends the same intent as typed words; the robot fetches it (a real duck waits for its own scan). There is no
  pay-now button (Kris, 7 Nov).
- Composer: one card-radius surface with the owner's words on top and a toolbar inside it: the brain menu on the
  left, a round ink Send arrow on the right (disabled while the field is empty). With one brain the toolbar folds
  into the field's row.
- Brain menu: a quiet button with the model's name, a green TEE tag when its provider is a TEE, and a chevron. It
  opens a Foldkit UI Listbox above itself; each model has its name and one plain line, and a check marks the pick.
  Selection is ink, never duck yellow.
- Dock line: shown only when the robot can't be sent or the owner should know something first (on an errand, no
  allowance, allowance stopped or ended); the pills and the field point to it with aria-describedby. A ready dock says
  nothing. The header's allowance pill says which: No allowance, Stopping…, Stopped or Ended.
- Mic (when the Worker has voice on): a round paper button inside the composer, left of Send and the same size, so
  Send stays the ink primary. Hold it (or Space while it is focused): it turns duck yellow with a small halo, the
  header says "Listening…" and a faint owner bubble waits in the thread. The mic is open only while held. A line under
  the composer, one line high at all times so the composer never moves, says what the voice is doing ("Listening · let
  go to send", "listening to you…", "speaking…", or a failure in error red) and nothing at rest. The composer's focus
  frame is for typing only, not for a press on the mic. While the owner talks, the pills and the composer rest.
- Spoken bubbles: what Vita heard is an owner bubble with a small "you said"; Vita's line is a white bubble with a duck
  ring, its opener and closer in duck yellow, and "Vita said" under it. Vita's lines come from the Worker, built from
  the errand's real state; 0G's own reason sits under them as a quote, never spoken.
- Sheets: bottom sheets (Foldkit UI Dialog) for Receive and the allowance. Stop sits in the allowance sheet in
  error red on error-soft.

## Motion

Motion says the app heard the owner and that work is under way; it never decorates. The tokens are in the
`@theme` of `apps/web/src/styles.css`.

- Curves: `ease-out` is `cubic-bezier(0.23, 1, 0.32, 1)` and is also the default for every `transition-*`
  utility; `ease-in-out` is `cubic-bezier(0.77, 0, 0.175, 1)` for movement on screen; `ease-drawer` is
  `cubic-bezier(0.32, 0.72, 0, 1)` for sheets. Never `ease-in`.
- Durations: a press is 150ms (`active:scale-[0.96]`), a message entering 220ms, a page crossfade 180ms, a sheet
  260ms up and 180ms down. UI motion stays under 300ms; leaving is faster than entering.
- Waiting: a page that loads shows its skeleton (`Skeleton.ts`: rule-coloured blocks pulsing on a 1.5s cycle,
  never duck yellow) with a visually hidden "Loading..." status. Robots' faces in it are sleeping ducks, and a grey
  duck bobs above the conversation's and the cards' blocks (`--animate-bob`, 2.4s, still under reduced motion); the
  conversation's skeleton ends in the dock's pills and composer, so nothing jumps. A busy button shows the 600ms spinner beside its
  label, and a line that says work is under way starts with the three working dots (`Busy.ts`).
- What enters: only the live errand's messages (fade and 8px up from 98%). The history, lists on the wallet home,
  balances and amounts never animate.
- Paid: the conversation's duck hops once; OPEN on the gate and Paid on the approval page pop in once from 96%.
- Reduced motion keeps fades and drops movement; the dots keep pulsing and the spinner turns slower.
- Only `transform`, `translate`, `scale` and `opacity` animate; no looping decoration.

## Do's and Don'ts

- Do write "allowance", "Stop", "Connected" and "Show proof"; keep grant, revoke, lease, delegation and hashes out
  of the first layer.
- Do say "restricted item" and "needs your OK". Never call it an age check.
- Don't write a robot message that the errand's state does not support, and never invent a 0G decision. That holds
  for Vita's voice too: no model text is spoken.
- Don't show camera frames in the thread; show what the robot reads. Frames appear only as evidence, on the errand's
  page and the proof page.
