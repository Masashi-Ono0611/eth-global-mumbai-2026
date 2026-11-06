import { INSTRUCTION_MAX, type IntentView, isOpenIntent } from '@ethmumbai/protocol/Intent'
import { IntentView as IntentViewSchema } from '@ethmumbai/protocol/Intent'
import { clsx } from 'clsx'
import {
  background,
  ErrandPaymentReply,
  explorerTx,
  jsonInit,
  ownerFetch,
  request,
  RobotViewReply,
  usdc,
} from './api.ts'
import { renderTurns } from './brain.ts'
import { el, link } from './dom.ts'

// The owner's panel beside the duck: robot, lease and allowance; the instruction box (the same intent route the
// wallet's conversation uses, with the owner's session cookie); the live 0G brain; the errand's outcome with its Arc
// transaction; what is simulated and what is real; and Pollen's credit for the body.

// STYLES
const panelClassName =
  'fixed top-3 left-3 z-50 grid max-h-[calc(100dvh-5.5rem)] max-sm:max-h-[42dvh] w-[min(24rem,calc(100vw-1.5rem))] gap-3 overflow-y-auto rounded-xl bg-zinc-950/85 p-3 font-sans text-sm text-white shadow-2xl ring-1 ring-white/10 backdrop-blur'
const titleClassName = 'flex items-baseline justify-between gap-2'
const nameClassName = 'text-base font-semibold'
const pillClassName = 'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap'
const sectionClassName = 'grid gap-1.5'
const labelClassName = 'text-[11px] font-semibold tracking-wide text-white/50 uppercase'
const inputClassName =
  'min-h-11 w-full rounded-md border border-white/15 bg-black/40 px-3 text-sm text-white placeholder:text-white/40 focus:border-amber-300 focus:outline-none'
const buttonClassName =
  'min-h-11 shrink-0 cursor-pointer rounded-md border-0 bg-amber-400 px-4 text-sm font-semibold text-black hover:bg-amber-300 disabled:cursor-default disabled:opacity-50'
const ghostButtonClassName =
  'min-h-11 shrink-0 cursor-pointer rounded-md border border-white/20 bg-transparent px-3 text-sm text-white hover:bg-white/10'
const mutedClassName = 'text-xs text-white/60'
const linkClassName = 'text-amber-300 underline underline-offset-2'
// A centred line between the engine's quickbar (bottom left) and its speed readout (bottom right); touches pass through
// to the joystick under it on a phone.
const stripClassName =
  'pointer-events-none fixed bottom-2 left-1/2 z-40 w-max max-w-[calc(100vw-1.5rem)] -translate-x-1/2 rounded-full bg-black/75 px-3 py-1 text-center font-sans text-[11px] font-semibold text-white/85'
const creditClassName = 'text-[11px] text-white/50'
const bubbleClassName =
  'pointer-events-none fixed bottom-16 left-1/2 z-50 max-w-[min(32rem,90vw)] -translate-x-1/2 rounded-2xl bg-white px-4 py-2 font-sans text-base text-black shadow-xl transition-opacity duration-300'

export interface Panel {
  readonly chipStatus: (text: string, tone: 'ok' | 'wait' | 'bad') => void
  readonly chipLog: (text: string, href?: string) => void
  readonly navStatus: (text: string) => void
  readonly say: (text: string) => void
  readonly intent: (intent: IntentView) => void
  readonly ended: (reason: string) => void
}

const pill = () => el('span', pillClassName, ['…'])

const setPill = (node: HTMLElement, text: string, tone: 'ok' | 'wait' | 'bad') => {
  node.textContent = text
  node.className = clsx(pillClassName, {
    'bg-emerald-500/20 text-emerald-200': tone === 'ok',
    'bg-amber-500/20 text-amber-200': tone === 'wait',
    'bg-red-500/20 text-red-200': tone === 'bad',
  })
}

const section = (label: string, children: ReadonlyArray<Node | string>) =>
  el('section', sectionClassName, [el('h2', labelClassName, [label]), ...children])

const mountStrip = () =>
  document.body.appendChild(
    el('p', stripClassName, [
      'Simulated: body, camera, merchant screens · Real: 0G decisions, chip signature, Arc USDC',
    ]),
  )

// Pollen's credit sits at the foot of the panel, where its link can be clicked without covering the engine's controls.
const credit = () =>
  el('p', creditClassName, [
    'Duck body, physics and walking policy: ',
    link(
      'https://huggingface.co/spaces/pollen-robotics/microduck-simulator',
      linkClassName,
      'Pollen Robotics Microduck',
    ),
    ' (app Apache-2.0; meshes and policies CC BY-NC-SA, loaded from Hugging Face).',
  ])

const mountBubble = () => {
  const bubble = el('p', clsx(bubbleClassName, 'opacity-0'), [''])
  bubble.setAttribute('role', 'status')
  document.body.appendChild(bubble)
  let timer: ReturnType<typeof setTimeout> | undefined
  return (text: string) => {
    bubble.textContent = `🦆 ${text}`
    bubble.className = clsx(bubbleClassName, 'opacity-100')
    clearTimeout(timer)
    timer = setTimeout(() => (bubble.className = clsx(bubbleClassName, 'opacity-0')), 6000)
  }
}

/** The owner's robot card: name, lease, allowance. Refreshes every 10 s; a 401 means no wallet session here. */
const robotCard = (robotId: string, name: HTMLElement, lease: HTMLElement, allowance: HTMLElement) => {
  const refresh = async () => {
    const reply = await request(ownerFetch, `/api/robots/${encodeURIComponent(robotId)}`, RobotViewReply)
    // The lease pill shows only once the robot is read: a placeholder beside the chip's pill reads as a cut-off label.
    lease.hidden = !reply.ok
    if (!reply.ok) {
      allowance.replaceChildren(
        reply.status === 401
          ? link('/', linkClassName, 'Sign in to the wallet in this browser to send errands')
          : `robot unavailable (${reply.status})`,
      )
      return
    }
    const { robot, lease: state, grant } = reply.value
    name.textContent = robot.name
    setPill(lease, state.online ? 'online' : robot.status, state.online ? 'ok' : 'wait')
    allowance.textContent =
      grant === null
        ? 'No allowance yet: grant one in the wallet.'
        : `Allowance ${usdc(grant.dailyCap)} USDC a day · ${usdc(grant.perPaymentCap)} per purchase (${grant.status})`
  }
  background(refresh())
  setInterval(() => background(refresh()), 10_000)
}

const instructionForm = (robotId: string, onSent: (intent: IntentView) => void, report: (text: string) => void) => {
  const input = el('input', inputClassName)
  input.placeholder = 'Get me a chai'
  input.maxLength = INSTRUCTION_MAX
  input.setAttribute('aria-label', 'Errand for the duck')
  const send = el('button', buttonClassName, ['Send'])
  send.type = 'submit'
  const form = el('form', 'flex gap-2', [input, send])
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const instruction = input.value.trim()
    if (instruction === '') return
    send.disabled = true
    const sent = request(
      ownerFetch,
      `/api/robots/${encodeURIComponent(robotId)}/intents`,
      IntentViewSchema,
      jsonInit('POST', { instruction }),
    ).then((reply) => {
      send.disabled = false
      if (!reply.ok)
        return report(reply.status === 409 ? 'The duck is already on an errand.' : `Not sent: ${reply.error}`)
      input.value = ''
      onSent(reply.value)
    })
    background(sent)
  })
  return form
}

/** Polls the owner's intent read for the brain list and the outcome while an intent is open (and once after). */
const intentWatch = (robotId: string, turns: HTMLElement, outcome: HTMLElement) => {
  let current: string | null = null
  const showOutcome = async (intent: IntentView) => {
    const lines: Array<Node | string> = [`“${intent.instruction}” · ${intent.state}`]
    if (intent.episodeState !== null) lines.push(` · errand ${intent.episodeState}`)
    if (intent.reason !== null) lines.push(` · ${intent.reason}`)
    if (intent.episodeId !== null) {
      const path = `/api/robots/${encodeURIComponent(robotId)}/errands/${intent.episodeId}`
      const errand = await request(ownerFetch, path, ErrandPaymentReply)
      const tx = errand.ok ? errand.value.payment?.txHash : null
      if (tx !== null && tx !== undefined) lines.push(' · ', link(explorerTx(tx), linkClassName, 'Arc transaction ↗'))
    }
    outcome.replaceChildren(...lines)
  }
  const poll = async (intentId: string) => {
    const path = `/api/robots/${encodeURIComponent(robotId)}/intents/${intentId}`
    // Two reads after the intent ends, so the last turn's TEE proof (written after the reply) shows too.
    for (let closedReads = 0; closedReads < 2;) {
      if (current !== intentId) return
      const reply = await request(ownerFetch, path, IntentViewSchema)
      if (reply.ok) {
        renderTurns(turns, reply.value.turns)
        await showOutcome(reply.value)
        if (!isOpenIntent(reply.value.state)) closedReads += 1
      }
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }
  return (intent: IntentView) => {
    if (current === intent.id) return
    current = intent.id
    renderTurns(turns, intent.turns)
    background(poll(intent.id))
  }
}

export const mountPanel = (robotId: string, stop: (intentId: string) => void): Panel => {
  const name = el('h1', nameClassName, ['Simulator duck'])
  const lease = pill()
  const chip = pill()
  const allowance = el('p', mutedClassName, ['…'])
  const navStatus = el('p', mutedClassName, ['waiting for the duck to boot'])
  const turns = el('div')
  const outcome = el('p', 'text-xs text-white/80', ['No errand yet.'])
  const chipLines = el('ul', 'grid list-none gap-0.5 text-xs text-white/60')
  const stopButton = el('button', ghostButtonClassName, ['Stop'])
  stopButton.type = 'button'
  // Stop shows only while an errand is open: there is nothing to stop before one starts or after it ends.
  stopButton.hidden = true
  let openIntent: string | null = null
  stopButton.addEventListener('click', () => {
    if (openIntent !== null) stop(openIntent)
  })
  const watch = intentWatch(robotId, turns, outcome)
  const intent = (view: IntentView) => {
    openIntent = isOpenIntent(view.state) ? view.id : null
    stopButton.hidden = openIntent === null
    watch(view)
  }
  const form = instructionForm(robotId, intent, (text) => (navStatus.textContent = text))
  robotCard(robotId, name, lease, allowance)
  renderTurns(turns, [])
  setPill(chip, 'chip starting', 'wait')
  lease.hidden = true
  const panel = el('aside', panelClassName, [
    el('header', 'grid gap-1', [el('div', titleClassName, [name, el('span', 'flex gap-1', [chip, lease])]), allowance]),
    section('Errand', [form, el('div', 'flex items-center justify-between gap-2', [navStatus, stopButton]), outcome]),
    // Each turn card names the model that answered it: never a hard-coded one here.
    section('0G brain', [turns]),
    section('Chip', [chipLines]),
    credit(),
  ])
  panel.setAttribute('aria-label', 'Vitaquack simulator')
  document.body.appendChild(panel)
  mountStrip()
  return {
    chipStatus: (text, tone) => setPill(chip, text, tone),
    chipLog: (text, href) => {
      const line = el('li', '', href === undefined ? [text] : [text, ' ', link(href, linkClassName, 'tx ↗')])
      chipLines.insertBefore(line, chipLines.firstChild)
      while (chipLines.childElementCount > 6) chipLines.lastElementChild?.remove()
    },
    navStatus: (text) => (navStatus.textContent = text),
    say: mountBubble(),
    intent,
    ended: (reason) => {
      openIntent = null
      stopButton.hidden = true
      navStatus.textContent = `ended: ${reason}`
    },
  }
}
