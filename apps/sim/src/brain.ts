import type { NavCall, NavTurnView } from '@ethmumbai/protocol/Intent'
import { clsx } from 'clsx'
import { el } from './dom.ts'

// The live "0G brain" list: one card per stored navigation turn, with the model that answered it (ZG_MODEL or the
// brain the owner picked with the message), the tool calls it chose, its short reasoning (model output, shown to the
// owner only) and whether the turn's TEE signature verified. A turn is stored with its proof, so a turn without one
// (a provider that publishes none, or a proof that could not be fetched) has none.

// STYLES
const listClassName = 'grid gap-2'
const cardClassName = 'grid gap-1 rounded-md bg-white/5 p-2 ring-1 ring-white/10'
const headClassName = 'flex items-center justify-between gap-2 text-[11px] text-white/60 tabular-nums'
const reasoningClassName = 'text-xs text-white/70 italic line-clamp-3'
const callClassName = 'font-mono text-xs break-words text-amber-200'
const errorClassName = 'text-xs text-red-300'
const badgeClassName = 'rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide'

const short = (value: unknown) => {
  const text = typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value ?? null)
  return text.length > 60 ? `${text.slice(0, 57)}…"` : text
}

/** `go_to(chai_stall)`, `say("Quack, one chai")`, `look()`. */
export const callLabel = (call: NavCall) => {
  const values = Object.values(call.args)
  if (call.name === 'go_to' && typeof call.args.place === 'string') return `go_to(${call.args.place})`
  return `${call.name}(${values.map(short).join(', ')})`
}

const teeBadge = (turn: NavTurnView) => {
  const verified = turn.tee?.verified === true
  const text = turn.tee === null ? 'No TEE proof' : verified ? 'TEE ✓ verified' : 'TEE unverified'
  return el(
    'span',
    clsx(badgeClassName, {
      'bg-emerald-500/20 text-emerald-200': verified,
      'bg-amber-500/20 text-amber-200': turn.tee !== null && !verified,
      'bg-white/10 text-white/50': turn.tee === null,
    }),
    [text],
  )
}

const turnCard = (turn: NavTurnView) =>
  el('li', cardClassName, [
    el('div', headClassName, [
      `Turn ${turn.step} · ${turn.model}${turn.latencyMs === null ? '' : ` · ${(turn.latencyMs / 1000).toFixed(1)} s`}`,
      teeBadge(turn),
    ]),
    ...(turn.reasoning === null || turn.reasoning.trim() === ''
      ? []
      : [el('p', reasoningClassName, [turn.reasoning.trim().slice(0, 240)])]),
    ...turn.calls.map((call) => el('p', callClassName, [callLabel(call)])),
    ...(turn.error === null ? [] : [el('p', errorClassName, [turn.error])]),
  ])

export const renderTurns = (target: HTMLElement, turns: ReadonlyArray<NavTurnView>) => {
  const list = el('ol', listClassName, turns.toReversed().map(turnCard))
  target.replaceChildren(
    turns.length === 0 ? el('p', 'text-xs text-white/50', ['No turns yet: give the duck an errand.']) : list,
  )
}
