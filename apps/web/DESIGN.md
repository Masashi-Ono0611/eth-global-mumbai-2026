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
records) stays one tap away behind "Show proof". Each robot is a conversation. The owner taps what to buy, the robot
reports each step back as a message, and when it needs the owner it asks inside the message with the buttons there.
Light only, phone first.

## Colors

Paper is the page; white surfaces carry content. Ink is the owner's voice (their bubbles, primary buttons) and the
default text. Duck yellow means one thing: the robot needs the owner (an approval, the "needs you" card, a badge). It
is never used for decoration. Paid green marks money that moved; error red marks a refusal, a failure or Stop.
Approve with World ID is black, matching World's own sign-in button.

## Typography

Baloo 2 sets amounts, headings and robot names; Mukta sets everything else. Both come from Ek Type and cover
Devanagari. Numbers that change (balances, amounts, countdowns) use tabular figures.

## Layout

One centred column at phone width, also on a desktop. Home reads top to bottom: balance, the action pills (Send,
Receive, Robot), "Needs you", robots, payments. A robot's page is its thread: header, messages oldest to newest, and
the buy buttons docked at the bottom like a keyboard.

## Shapes

Bubbles use the bubble radius with the corner nearest the speaker tightened, so it is clear who spoke. Cards and
lists use the card radius, bottom sheets the sheet radius, buttons the control radius, and pills are fully round.

## Components

- Owner bubble: right-aligned, ink. It holds what the owner asked for ("Buy chai").
- Robot bubble: left-aligned, white. It is written from the errand's real state. 0G's reason is quoted word for
  word under a rule. The invoice QR is drawn from the invoice URL and is never presented as a camera frame.
- Asking bubble: duck yellow, with Approve with World ID and No inside it. It is used only for an approval that
  is waiting.
- Receipt: inside a robot bubble. Paid amount in the amount face, a paid check, and "Show proof".
- System pill: centred and muted, for events that are not anyone's words ("Duck connected at 15:56").
- Buy chips: the dock's buttons, one per catalogue item with its price. They are dimmed while an errand is live or
  while the robot has no allowance.
- Sheets: bottom sheets (Foldkit UI Dialog) for Receive and the allowance. Stop sits in the allowance sheet in
  error red on error-soft.

## Do's and Don'ts

- Do write "allowance", "Stop", "Connected" and "Show proof"; keep grant, revoke, lease, delegation and hashes out
  of the first layer.
- Do say "restricted item" and "needs your OK". Never call it an age check.
- Don't write a robot message that the errand's state does not support, and never invent a 0G decision.
- Don't show camera frames; show what the robot reads.
