import { API, type PageComment, QUOTE_MAX, QUOTE_MIN, type Selected, type State, type Status, page, store } from './types.ts'
import { button, el, link, messageOf } from './dom.ts'
import { hash } from './anchors.ts'
import { richText } from './richtext.ts'
import { anyThread, isRoot, openThreadCount, repliesTo, rootsFor } from './threads.ts'
import { markParts, markQuotes } from './marks.ts'
import { deleteComment, fetchComments, patchStatus, postComment } from './api.ts'

const ownerIdOf = (state: State, start: Element): string | null => {
  for (let node: Element | null = start; node; node = node.parentElement) {
    const id = state.owners.get(node)
    if (id) return id
  }
  return null
}

const readSelection = (state: State): Selected | null => {
  const selection = getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const quote = selection.toString().replace(/\s+/g, ' ').trim()
  if (quote.length < QUOTE_MIN || quote.length > QUOTE_MAX) return null
  const range = selection.getRangeAt(0)
  const container = range.commonAncestorContainer
  const start = container instanceof Element ? container : container.parentElement
  if (!start || start.closest('svg, .cm-pop, .cm-panel, .cm-sel, .cm-btn')) return null
  const hostId = ownerIdOf(state, start)
  return hostId ? { hostId, quote, rect: range.getBoundingClientRect() } : null
}

export const showSelectButton = (state: State): void => {
  state.selected = readSelection(state)
  const { selectButton } = state
  if (!state.selected) {
    selectButton.style.display = 'none'
    return
  }
  selectButton.style.display = 'block'
  selectButton.style.top = `${window.scrollY + state.selected.rect.bottom + 6}px`
  selectButton.style.left = `${window.scrollX + state.selected.rect.right - selectButton.offsetWidth}px`
}

export const commentOnSelection = (state: State): void => {
  const selected = state.selected
  const host = selected ? state.anchors.get(selected.hostId) : undefined
  if (!selected || !host) return
  const id = `${selected.hostId}/q/${hash(selected.quote)}`
  state.anchors.set(id, { node: host.node, source: host.source, text: selected.quote })
  state.selectButton.style.display = 'none'
  // Measure again: the page may have scrolled since the selection was made (rects are viewport-relative).
  const live = getSelection()
  openPopover(state, id, live && live.rangeCount > 0 ? live.getRangeAt(0).getBoundingClientRect() : selected.rect)
}

// ---------- rendering ----------

export const render = (state: State): void => {
  markParts(state)
  markQuotes(state)
  for (const [id, btn] of state.buttons) {
    const count = openThreadCount(state, id)
    const done = count === 0 && anyThread(state, id)
    btn.classList.toggle('cm-has', count > 0)
    btn.classList.toggle('cm-done', done)
    btn.textContent = count > 0 ? String(count) : done ? '✓' : '💬'
  }
  const open = state.comments.filter((c) => isRoot(state, c) && c.status === 'open').length
  state.fab.textContent = `💬 Comments (${open} open)`
}

export const closePopover = (state: State): void => {
  state.popover?.remove()
  state.popover = null
  state.popoverAt = null
}

export const closePanel = (state: State): void => {
  state.panel?.remove()
  state.panel = null
}

/** Reload, then redraw whatever was open so the reader keeps their place. */
export const refresh = (state: State): void => {
  const reopen = state.popoverAt
  const panelWasOpen = state.panel !== null
  const redraw = (comments: ReadonlyArray<PageComment>): void => {
    state.comments = comments
    render(state)
    if (reopen) openPopover(state, reopen.id, reopen.rect)
    if (panelWasOpen) {
      closePanel(state)
      openPanel(state)
    }
  }
  fetchComments().then(redraw, () => redraw([]))
}

const report = (prefix: string) => (error: unknown): void => {
  alert(`${prefix}: ${messageOf(error)}`)
}

const removeComment = (state: State, id: string): void => {
  if (!confirm('Delete this comment?')) return
  deleteComment(id).then(() => refresh(state), report('Could not delete'))
}

const setStatus = (state: State, id: string, status: Status): void => {
  const by = store.get('name') || prompt('Your name')?.trim() || ''
  if (!by) return
  store.set('name', by)
  patchStatus(id, status, by).then(() => refresh(state), report('Could not update'))
}

const STATUS_LABEL: Readonly<Record<Status, string>> = { open: 'open', resolved: '✓ resolved', accepted: '✓ accepted', rejected: '✗ rejected' }

const statusBar = (state: State, root: PageComment): HTMLElement => {
  if (root.status !== 'open') {
    const label = `${STATUS_LABEL[root.status]}${root.statusBy ? ` by ${root.statusBy}` : ''}`
    return el('div', { className: 'cm-status' }, el('span', { className: `cm-chip cm-${root.status}`, textContent: label }), button('Reopen', 'cm-link', () => setStatus(state, root.id, 'open')))
  }
  return el(
    'div',
    { className: 'cm-status' },
    button('Resolve', 'cm-link', () => setStatus(state, root.id, 'resolved')),
    button('Accept', 'cm-link', () => setStatus(state, root.id, 'accepted')),
    button('Reject', 'cm-link', () => setStatus(state, root.id, 'rejected')),
  )
}

const commentView = (state: State, comment: PageComment, depth: number): HTMLElement => {
  const replySlot = el('div')
  const actions = el(
    'span',
    { className: 'cm-actions' },
    button('Reply', 'cm-link', () => {
      replySlot.replaceChildren(form(state, { anchor: comment.anchor, anchorText: comment.anchorText, parentId: comment.id }, 'Reply…'))
      replySlot.querySelector('textarea')?.focus()
    }),
    button('delete', 'cm-link cm-del', () => removeComment(state, comment.id)),
  )
  const meta = el('div', { className: 'cm-meta' }, el('span', { textContent: `${comment.name} · ${new Date(comment.createdAt).toLocaleString()}` }), actions)
  const replies = repliesTo(state, comment.id).map((reply) => commentView(state, reply, depth + 1))
  const node = el('div', { className: depth === 0 ? 'cm-item' : 'cm-item cm-reply' }, meta, richText(comment.body), replySlot, ...replies)
  return node
}

const threadView = (state: State, root: PageComment): HTMLElement =>
  el('div', { className: `cm-thread cm-thread-${root.status}` }, statusBar(state, root), commentView(state, root, 0))

/** Open threads first; resolved ones folded behind a toggle. */
const threadsView = (state: State, roots: ReadonlyArray<PageComment>): HTMLElement[] => {
  const open = roots.filter((r) => r.status === 'open').map((r) => threadView(state, r))
  const closed = roots.filter((r) => r.status !== 'open')
  if (closed.length === 0) return open
  const folded = el('div', { hidden: !state.showResolved }, ...closed.map((r) => threadView(state, r)))
  const toggle = button(`${state.showResolved ? 'Hide' : 'Show'} ${closed.length} closed`, 'cm-link cm-toggle', () => {
    state.showResolved = !state.showResolved
    folded.hidden = !state.showResolved
    toggle.textContent = `${state.showResolved ? 'Hide' : 'Show'} ${closed.length} closed`
  })
  return [...open, toggle, folded]
}

const form = (state: State, target: { readonly anchor: string; readonly anchorText: string; readonly parentId: string | null }, placeholder: string): HTMLElement => {
  const name = el('input', { placeholder: 'Your name', value: store.get('name'), maxLength: 60 })
  const body = el('textarea', { placeholder: `${placeholder} (⌘/Ctrl+Enter to send)`, maxLength: 4000 })
  const error = el('div', { className: 'cm-err' })
  const submit = (): void => {
    if (!body.value.trim() || !name.value.trim()) {
      error.textContent = 'Name and comment, please.'
      return
    }
    store.set('name', name.value.trim())
    postComment({ ...target, name: name.value.trim(), body: body.value.trim() }).then(
      () => {
        getSelection()?.removeAllRanges()
        refresh(state)
      },
      (failure: unknown) => {
        error.textContent = `Could not save: ${messageOf(failure)}`
      },
    )
  }
  body.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submit()
  })
  const actions = el('div', { className: 'cm-row' }, button('Cancel', 'cm-ghost', () => closePopover(state)), button(target.parentId ? 'Reply' : 'PageComment', '', submit))
  return el('div', { className: 'cm-form' }, name, body, error, actions)
}

export function openPopover(state: State, id: string, rect: DOMRect): void {
  closePopover(state)
  const anchor = state.anchors.get(id)
  if (!anchor) return
  const title = anchor.text.length > 90 ? `${anchor.text.slice(0, 90)}…` : anchor.text
  const popover = el(
    'div',
    { className: 'cm-pop' },
    el('h4', { textContent: title }),
    ...threadsView(state, rootsFor(state, id)),
    form(state, { anchor: id, anchorText: anchor.text, parentId: null }, 'New comment…'),
  )
  document.body.appendChild(popover)
  const viewport = document.documentElement.clientWidth
  popover.style.top = `${window.scrollY + rect.bottom + 6}px`
  popover.style.left = `${window.scrollX + Math.max(8, Math.min(rect.right - popover.offsetWidth, viewport - popover.offsetWidth - 8))}px`
  state.popover = popover
  state.popoverAt = { id, rect }
}

const anchorGroup = (state: State, id: string, text: string, node: HTMLElement | null): HTMLElement[] => {
  const label = text.slice(0, 120)
  const head = node ? link(label, () => node.scrollIntoView({ behavior: 'smooth', block: 'center' })) : el('span', { textContent: label })
  return [el('div', { className: 'cm-quote' }, head), ...threadsView(state, rootsFor(state, id))]
}

export function openPanel(state: State): void {
  const known = [...state.anchors].filter(([id]) => rootsFor(state, id).length > 0)
  const orphanAnchors = [...new Set(state.comments.filter((c) => !state.anchors.has(c.anchor) && isRoot(state, c)).map((c) => c.anchor))]
  const open = state.comments.filter((c) => isRoot(state, c) && c.status === 'open').length
  const header = el('div', { className: 'cm-row' }, el('strong', { textContent: `Comments: ${open} open of ${state.comments.filter((c) => isRoot(state, c)).length} threads` }), button('Close', 'cm-ghost', () => closePanel(state)))
  const agents = el('p', {}, el('a', { href: `${API}.md?page=${encodeURIComponent(page)}`, target: '_blank', textContent: 'Markdown for agents' }))
  const grouped = known.flatMap(([id, anchor]) => anchorGroup(state, id, anchor.text, anchor.node))
  const orphanTitle = orphanAnchors.length > 0 ? el('h3', { textContent: 'Comments on changed text' }) : null
  const orphaned = orphanAnchors.flatMap((id) => anchorGroup(state, id, state.comments.find((c) => c.anchor === id)?.anchorText ?? id, null))
  state.panel = el('aside', { className: 'cm-panel' }, header, agents, ...grouped, orphanTitle, ...orphaned)
  document.body.appendChild(state.panel)
}
