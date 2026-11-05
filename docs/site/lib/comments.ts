/**
 * Login-free comments for docs/site pages. The site build compiles this file to /lib/comments.js.
 *
 * Opt in with <script src="/lib/comments.js" defer></script>. Three granularities, one storage:
 * - Elements: every heading, card, table row, list item, callout and diagram gets a 💬 on hover. Anchor:
 *   `<section>/<kind>/<text hash>`. An element inside another commentable element doesn't get its own.
 * - Diagram parts: click a node, group, arrow or sequence message in a Pele diagram. Anchor:
 *   `<diagram anchor>/n/<pele data-id>:<label hash>`. Commented parts glow.
 * - Selected text: select words inside any element and press "💬 PageComment". Anchor: `<element anchor>/q/<quote hash>`;
 *   the quote is stored as anchorText and highlighted on load.
 * Threads: every comment has Reply (nested, any depth); a thread can be Resolved, Accepted or Rejected (and reopened);
 * closed threads fold away and badges count open threads only.
 * No login and no code: your name is asked once and kept in localStorage. If the text a comment points to changes, the
 * comment moves to "Comments on changed text" in the panel. Agents read everything at /api/comments.md?page=<slug>.
 */


import { PART, type State } from './comments/types'
import { css } from './comments/style'
import { el } from './comments/dom'
import { collectAnchors, ownersOf } from './comments/anchors'
import { registerPart } from './comments/marks'
import { closePanel, closePopover, commentOnSelection, openPanel, openPopover, refresh, render, showSelectButton } from './comments/view'

// ---------- wiring ----------

const attachButtons = (state: State): void => {
  for (const [id, { node }] of state.anchors) {
    node.classList.add('cm-host')
    const btn = el('button', { className: 'cm-btn', type: 'button', title: 'PageComment', textContent: '💬' })
    btn.addEventListener('click', (event) => {
      event.stopPropagation()
      openPopover(state, id, btn.getBoundingClientRect())
    })
    node.appendChild(btn)
    state.buttons.set(id, btn)
  }
}

/** Click (not drag: Pele pans on drag) a diagram part to comment on it. */
const watchDiagram = (state: State, diagramId: string, host: HTMLElement): void => {
  let down: { readonly x: number; readonly y: number } | null = null
  host.addEventListener('pointerdown', (event) => {
    down = { x: event.clientX, y: event.clientY }
  })
  host.addEventListener('click', (event) => {
    const dragged = down !== null && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5
    const part = event.target instanceof Element ? event.target.closest(PART) : null
    if (dragged || !part) return
    event.stopPropagation()
    openPopover(state, registerPart(state, diagramId, part), part.getBoundingClientRect())
  })
}

const openMark = (state: State, target: EventTarget | null): boolean => {
  const mark = target instanceof Element ? target.closest('.cm-mark') : null
  const id = mark instanceof HTMLElement ? mark.dataset['anchor'] : undefined
  if (!mark || !id) return false
  openPopover(state, id, mark.getBoundingClientRect())
  return true
}

const listenGlobally = (state: State): void => {
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    closePopover(state)
    closePanel(state)
  })
  document.addEventListener('click', (event) => {
    if (openMark(state, event.target)) return
    const target = event.target
    const onButton = target instanceof HTMLElement && target.matches('.cm-btn, .cm-sel')
    if (state.popover && target instanceof Node && !state.popover.contains(target) && !onButton) closePopover(state)
  })
  let pending = 0
  document.addEventListener('selectionchange', () => {
    window.clearTimeout(pending)
    pending = window.setTimeout(() => showSelectButton(state), 200)
  })
  // Keep the selection alive while pressing the button.
  state.selectButton.addEventListener('pointerdown', (event) => event.preventDefault())
  state.selectButton.addEventListener('click', () => commentOnSelection(state))
  state.fab.addEventListener('click', () => (state.panel ? closePanel(state) : openPanel(state)))
}

const start = (): void => {
  document.head.appendChild(el('style', { textContent: css }))
  const anchors = collectAnchors()
  const state: State = {
    anchors,
    owners: ownersOf(anchors),
    buttons: new Map(),
    marked: new Set(),
    fab: el('button', { className: 'cm-fab', type: 'button' }),
    selectButton: el('button', { className: 'cm-sel', type: 'button', textContent: '💬 PageComment on selection' }),
    glow: el('style'),
    comments: [],
    popover: null,
    panel: null,
    selected: null,
    popoverAt: null,
    showResolved: false,
  }
  document.body.appendChild(state.fab)
  document.body.appendChild(state.selectButton)
  document.head.appendChild(state.glow)
  attachButtons(state)
  let diagramIndex = 0
  for (const [id, { node }] of anchors) {
    if (!node.classList.contains('diagram')) continue
    node.dataset['cmDiagram'] = String(diagramIndex++)
    watchDiagram(state, id, node)
  }
  listenGlobally(state)
  render(state)
  refresh(state)
}

start()
