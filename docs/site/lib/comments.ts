/**
 * Login-free comments for docs/site pages. The site build compiles this file to /lib/comments.js.
 *
 * Opt in with <script src="/lib/comments.js" defer></script>. Three granularities, one storage:
 * - Elements: every heading, card, table row, list item, callout and diagram gets a 💬 on hover. Anchor:
 *   `<section>/<kind>/<text hash>`. An element inside another commentable element doesn't get its own.
 * - Diagram parts: click a node, group, arrow or sequence message in a Pele diagram. Anchor:
 *   `<diagram anchor>/n/<pele data-id>:<label hash>`. Commented parts glow.
 * - Selected text: select words inside any element and press "💬 Comment". Anchor: `<element anchor>/q/<quote hash>`;
 *   the quote is stored as anchorText and highlighted on load.
 * No login and no code: your name is asked once and kept in localStorage. If the text a comment points to changes, the
 * comment moves to "Comments on changed text" in the panel. Agents read everything at /api/comments.md?page=<slug>.
 */

interface Comment {
  readonly id: string
  readonly anchor: string
  readonly anchorText: string
  readonly name: string
  readonly body: string
  readonly createdAt: string
}

interface Anchor {
  /** Where the 💬 button lives and what the panel scrolls to. */
  readonly node: HTMLElement
  /** The element whose text is the anchor (differs from `node` for table rows and <summary>). */
  readonly source: HTMLElement
  readonly text: string
}

interface Selected {
  readonly hostId: string
  readonly quote: string
  readonly rect: DOMRect
}

interface State {
  readonly anchors: Map<string, Anchor>
  readonly owners: Map<Element, string>
  readonly buttons: Map<string, HTMLButtonElement>
  readonly marked: Set<string>
  readonly fab: HTMLButtonElement
  readonly selectButton: HTMLButtonElement
  /** Glow for commented diagram parts, as CSS rules: Pele rewrites its SVG elements' class attributes. */
  readonly glow: HTMLStyleElement
  comments: ReadonlyArray<Comment>
  popover: HTMLElement | null
  panel: HTMLElement | null
  selected: Selected | null
}

const API = '/api/comments'
const SELECTOR =
  'main h1, main h2, main h3, main .card, main .rule, main tr, main li, main .diagram, main details > summary, main p.lead'
/** Pele diagram parts that can be commented on (all carry a `data-id`). */
const PART = '.pele-node, .pele-cluster, .pele-edge, .pele-edge-label, .pele-message'
const QUOTE_MIN = 3
const QUOTE_MAX = 280
const page = location.pathname.replace(/^\/|\/$/g, '') || 'index'

const store = {
  get: (key: 'name'): string => localStorage.getItem(`comments.${key}`) ?? '',
  set: (key: 'name', value: string): void => {
    localStorage.setItem(`comments.${key}`, value)
  },
}

const css = `
  .cm-host { position: relative; }
  .cm-btn { position: absolute; top: 6px; right: 6px; width: 28px; height: 28px; border-radius: 999px; border: 1px solid var(--line, #ddd);
    background: var(--card, #fff); color: var(--ink, #111); font: 13px/26px system-ui, sans-serif; text-align: center; cursor: pointer; padding: 0;
    opacity: 0; transition: opacity .12s; z-index: 5; }
  .cm-host:hover > .cm-btn, .cm-btn.cm-has, .cm-btn:focus-visible { opacity: 1; }
  .cm-btn.cm-has { background: var(--duck, #f5b700); color: #1d1b16; border-color: transparent; font-weight: 700; }
  td.cm-host > .cm-btn { top: 50%; transform: translateY(-50%); }
  .diagram.cm-host > .cm-btn { right: auto; left: 6px; } /* Pele's zoom controls sit top-right */
  @media (hover: none) { .cm-btn { opacity: .55; } }
  .diagram.cm-host :is(.pele-node, .pele-cluster, .pele-edge-label, .pele-message) { cursor: pointer; }
  .diagram.cm-host :is(.pele-node, .pele-edge-label, .pele-message):hover { filter: drop-shadow(0 0 3px var(--arc, #2f6bff)); }
  .cm-mark { background: color-mix(in srgb, var(--duck, #f5b700) 38%, transparent); color: inherit; border-radius: 3px; padding: 0 1px; cursor: pointer; }
  .cm-sel { position: absolute; z-index: 45; border: 0; border-radius: 999px; padding: 6px 10px; background: var(--ink, #111); color: var(--bg, #fff);
    font: 600 12px system-ui, sans-serif; cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,.2); display: none; }
  .cm-pop { position: absolute; z-index: 50; width: min(380px, 92vw); background: var(--card, #fff); color: var(--ink, #111);
    border: 1px solid var(--line, #ddd); border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.18); padding: 12px; font: 14px/1.45 system-ui, sans-serif; }
  .cm-pop h4 { margin: 0 0 8px; font-size: 12px; color: var(--muted, #666); font-weight: 600; }
  .cm-item { border-top: 1px solid var(--line, #eee); padding: 8px 0; white-space: pre-wrap; word-break: break-word; }
  .cm-meta { color: var(--muted, #666); font-size: 12px; margin-bottom: 2px; display: flex; justify-content: space-between; gap: 8px; }
  .cm-del { border: 0; background: none; color: var(--muted, #888); cursor: pointer; font-size: 12px; padding: 0; }
  .cm-pop textarea, .cm-pop input { width: 100%; box-sizing: border-box; margin-top: 6px; padding: 8px; border-radius: 8px;
    border: 1px solid var(--line, #ccc); background: var(--bg, #fff); color: inherit; font: inherit; }
  .cm-pop textarea { min-height: 72px; resize: vertical; }
  .cm-row { display: flex; gap: 8px; margin-top: 8px; align-items: center; justify-content: space-between; }
  .cm-row button { padding: 7px 12px; border-radius: 8px; border: 0; background: var(--arc, #2f6bff); color: #fff; font: 600 13px system-ui, sans-serif; cursor: pointer; }
  .cm-row .cm-ghost { background: none; color: var(--muted, #666); border: 1px solid var(--line, #ccc); }
  .cm-err { color: var(--deny, #d64545); font-size: 12px; margin-top: 6px; }
  .cm-fab { position: fixed; right: 16px; bottom: 16px; z-index: 40; border: 0; border-radius: 999px; padding: 10px 14px;
    background: var(--ink, #111); color: var(--bg, #fff); font: 600 13px system-ui, sans-serif; cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,.2); }
  .cm-panel { position: fixed; top: 0; right: 0; bottom: 0; width: min(420px, 100vw); z-index: 60; overflow: auto; padding: 16px; box-sizing: border-box;
    background: var(--card, #fff); color: var(--ink, #111); border-left: 1px solid var(--line, #ddd); box-shadow: -12px 0 40px rgba(0,0,0,.15);
    font: 14px/1.45 system-ui, sans-serif; }
  .cm-panel h3 { margin: 18px 0 6px; font-size: 13px; }
  .cm-panel a { color: var(--arc, #2f6bff); cursor: pointer; }
  .cm-quote { color: var(--muted, #666); font-size: 12px; border-left: 3px solid var(--line, #ddd); padding-left: 8px; margin: 12px 0 2px; }
`

// ---------- small DOM helpers ----------

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: ReadonlyArray<Node | null>
): HTMLElementTagNameMap[K] => {
  const node = Object.assign(document.createElement(tag), props)
  // appendChild, not append: the repo also loads Cloudflare's Worker types, whose HTMLRewriter `Element.append` shadows the DOM one.
  for (const child of children) if (child !== null) node.appendChild(child)
  return node
}

const button = (label: string, className: string, onClick: () => void): HTMLButtonElement => {
  const node = el('button', { type: 'button', className, textContent: label })
  node.addEventListener('click', onClick)
  return node
}

const link = (label: string, onClick: () => void): HTMLAnchorElement => {
  const node = el('a', { textContent: label, href: '#' })
  node.addEventListener('click', (event) => {
    event.preventDefault()
    onClick()
  })
  return node
}

const textOf = (node: Element): string =>
  (node instanceof HTMLElement ? node.innerText : (node.textContent ?? '')).replace(/\s+/g, ' ').trim()

/** SVG labels are split into <tspan> lines with no whitespace between them. */
const svgText = (node: Element): string => {
  const lines = [...node.querySelectorAll('tspan')].map((line) => line.textContent ?? '')
  return (lines.length > 0 ? lines.join(' ') : (node.textContent ?? '')).replace(/\s+/g, ' ').trim()
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ---------- anchors: which elements can be commented on ----------

const hash = (text: string): string => {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0
  return h.toString(36)
}

const slug = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

const isSection = (node: Element): boolean => node.tagName === 'H1' || node.tagName === 'H2'

const isSkipped = (node: Element): boolean =>
  node.parentElement?.closest(SELECTOR) != null || (node.tagName === 'TR' && node.querySelector('th') !== null)

const labelOf = (node: Element): string => {
  const pre = node.classList.contains('diagram') ? node.querySelector('pre') : null
  return pre ? `diagram:${textOf(pre).slice(0, 200)}` : textOf(node)
}

const kindOf = (node: Element): string => {
  const first = node.classList.item(0)
  return first ? `${node.tagName.toLowerCase()}.${first}` : node.tagName.toLowerCase()
}

/** Where the button goes: a button can't live directly in a <tr>, and clicking inside a <summary> toggles <details>. */
const hostOf = (node: HTMLElement): HTMLElement => {
  const target = node.tagName === 'SUMMARY' ? node.parentElement : node.tagName === 'TR' ? node.lastElementChild : node
  return target instanceof HTMLElement ? target : node
}

/** Anchor id = nearest h1/h2 section + element kind + hash of its own text: stable while the text stays the same. */
const collectAnchors = (): Map<string, Anchor> => {
  const anchors = new Map<string, Anchor>()
  let section = 'top'
  for (const node of document.querySelectorAll<HTMLElement>(SELECTOR)) {
    if (isSection(node)) section = slug(textOf(node)) || section
    const label = labelOf(node)
    if (isSkipped(node) || !label) continue
    let id = `${section}/${kindOf(node)}/${hash(label)}`
    while (anchors.has(id)) id += '+'
    anchors.set(id, { node: hostOf(node), source: node, text: textOf(node).slice(0, 160) })
  }
  return anchors
}

const ownersOf = (anchors: ReadonlyMap<string, Anchor>): Map<Element, string> => {
  const owners = new Map<Element, string>()
  for (const [id, anchor] of anchors) {
    owners.set(anchor.source, id)
    owners.set(anchor.node, id)
  }
  return owners
}

// ---------- diagram parts ----------

const partKind = (part: Element): string => {
  if (part.classList.contains('pele-cluster')) return 'group'
  return part.classList.contains('pele-node') ? 'node' : 'arrow'
}

const partLabel = (part: Element): string => {
  const id = part.getAttribute('data-id') ?? ''
  if (part.classList.contains('pele-cluster')) return svgText(part.querySelector('text') ?? part).slice(0, 120)
  if (part.classList.contains('pele-node')) return svgText(part)
  // Arrows and sequence messages: the label is a sibling element sharing the data-id.
  const label = part.closest('svg')?.querySelector(`.pele-edge-label[data-id="${CSS.escape(id)}"]`)
  return label ? svgText(label) : id
}

const partAnchorId = (diagramId: string, part: Element): string =>
  `${diagramId}/n/${part.getAttribute('data-id') ?? ''}:${hash(partLabel(part))}`

const registerPart = (state: State, diagramId: string, part: Element): string => {
  const id = partAnchorId(diagramId, part)
  const diagram = state.anchors.get(diagramId)
  if (diagram && !state.anchors.has(id)) {
    state.anchors.set(id, { node: diagram.node, source: diagram.source, text: `${partKind(part)}: ${partLabel(part)}`.slice(0, 280) })
  }
  return id
}

/** Glow on parts with comments (CSS rules keyed by data-id); also registers them so the panel doesn't list them as orphans. */
const markParts = (state: State): void => {
  const commented = new Set(state.comments.map((c) => c.anchor))
  const rules: string[] = []
  // Collect first: registerPart adds entries to state.anchors while we loop.
  const diagrams = [...state.anchors].filter(([, anchor]) => anchor.node.classList.contains('diagram'))
  for (const [diagramId, anchor] of diagrams) {
    for (const part of anchor.node.querySelectorAll(PART)) {
      if (!commented.has(partAnchorId(diagramId, part))) continue
      registerPart(state, diagramId, part)
      const key = CSS.escape(anchor.node.dataset['cmDiagram'] ?? '')
      rules.push(`.diagram[data-cm-diagram="${key}"] [data-id="${CSS.escape(part.getAttribute('data-id') ?? '')}"]`)
    }
  }
  state.glow.textContent =
    rules.length > 0 ? `${rules.join(',\n')} { filter: drop-shadow(0 0 3px var(--duck, #f5b700)) drop-shadow(0 0 2px var(--duck, #f5b700)); }` : ''
}

// ---------- text quotes ----------

const textNodesOf = (root: Element): Text[] => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest('.cm-btn, .cm-mark, svg, script, style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  })
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node instanceof Text) nodes.push(node)
  return nodes
}

/** Wraps the first whitespace-insensitive match of `quote` inside `root` in <mark>s; returns false if not found. */
const wrapQuote = (root: Element, quote: string, anchorId: string): boolean => {
  const nodes = textNodesOf(root)
  const match = new RegExp(quote.split(/\s+/).map(escapeRegExp).join('\\s+')).exec(nodes.map((n) => n.data).join(''))
  if (!match) return false
  const start = match.index
  const end = start + match[0].length
  let offset = 0
  for (const node of nodes) {
    const from = offset
    offset += node.data.length
    if (offset <= start || from >= end) continue
    const range = document.createRange()
    range.setStart(node, Math.max(start, from) - from)
    range.setEnd(node, Math.min(end, offset) - from)
    const mark = el('mark', { className: 'cm-mark' })
    mark.dataset['anchor'] = anchorId
    range.surroundContents(mark)
  }
  return true
}

const markQuotes = (state: State): void => {
  for (const comment of state.comments) {
    const at = comment.anchor.indexOf('/q/')
    const host = at > 0 ? state.anchors.get(comment.anchor.slice(0, at)) : undefined
    if (!host || state.marked.has(comment.anchor)) continue
    if (wrapQuote(host.source, comment.anchorText, comment.anchor)) {
      state.marked.add(comment.anchor)
      state.anchors.set(comment.anchor, { node: host.node, source: host.source, text: comment.anchorText })
    }
  }
}

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

const showSelectButton = (state: State): void => {
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

const commentOnSelection = (state: State): void => {
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

// ---------- API ----------

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const isComment = (value: unknown): value is Comment =>
  isRecord(value) &&
  ['id', 'anchor', 'anchorText', 'name', 'body', 'createdAt'].every((key) => typeof value[key] === 'string')

const send = async (path: string, init?: RequestInit): Promise<unknown> => {
  const res = await fetch(path, init)
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => '')}`.trim())
  return res.status === 204 ? null : res.json()
}

const fetchComments = async (): Promise<ReadonlyArray<Comment>> => {
  const body = await send(`${API}?page=${encodeURIComponent(page)}`)
  return Array.isArray(body) ? body.filter(isComment) : []
}

const postComment = (anchor: string, anchorText: string, name: string, body: string): Promise<unknown> =>
  send(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ page, anchor, anchorText, name, body }),
  })

const deleteComment = (id: string): Promise<unknown> =>
  send(`${API}/${encodeURIComponent(id)}`, { method: 'DELETE' })

// ---------- rendering ----------

const forAnchor = (state: State, id: string): ReadonlyArray<Comment> => state.comments.filter((c) => c.anchor === id)

/** An element's badge counts its own comments plus those on its diagram parts and quotes. */
const countFor = (state: State, id: string): number =>
  state.comments.filter((c) => c.anchor === id || c.anchor.startsWith(`${id}/`)).length

const render = (state: State): void => {
  markParts(state)
  markQuotes(state)
  for (const [id, btn] of state.buttons) {
    const count = countFor(state, id)
    btn.classList.toggle('cm-has', count > 0)
    btn.textContent = count > 0 ? String(count) : '💬'
  }
  state.fab.textContent = `💬 Comments (${state.comments.length})`
}

const refresh = (state: State): void => {
  fetchComments().then(
    (comments) => {
      state.comments = comments
      render(state)
    },
    () => {
      state.comments = []
      render(state)
    },
  )
}

const closePopover = (state: State): void => {
  state.popover?.remove()
  state.popover = null
}

const closePanel = (state: State): void => {
  state.panel?.remove()
  state.panel = null
}

const removeComment = (state: State, id: string): void => {
  const done = (): void => {
    closePopover(state)
    closePanel(state)
    refresh(state)
  }
  deleteComment(id).then(done, (error: unknown) => {
    alert(`Could not delete: ${messageOf(error)}`)
    done()
  })
}

const thread = (state: State, list: ReadonlyArray<Comment>): HTMLElement[] =>
  list.map((c) =>
    el(
      'div',
      { className: 'cm-item' },
      el(
        'div',
        { className: 'cm-meta' },
        el('span', { textContent: `${c.name} · ${new Date(c.createdAt).toLocaleString()}` }),
        button('delete', 'cm-del', () => removeComment(state, c.id)),
      ),
      el('div', { textContent: c.body }),
    ),
  )

const form = (state: State, id: string, text: string): HTMLElement => {
  const name = el('input', { placeholder: 'Your name', value: store.get('name'), maxLength: 60 })
  const body = el('textarea', { placeholder: 'Comment… (⌘/Ctrl+Enter to send)', maxLength: 4000 })
  const error = el('div', { className: 'cm-err' })
  const submit = (): void => {
    if (!body.value.trim() || !name.value.trim()) {
      error.textContent = 'Name and comment, please.'
      return
    }
    store.set('name', name.value.trim())
    postComment(id, text, name.value.trim(), body.value.trim()).then(
      () => {
        closePopover(state)
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
  const actions = el('div', { className: 'cm-row' }, button('Cancel', 'cm-ghost', () => closePopover(state)), button('Comment', '', submit))
  return el('div', {}, name, body, error, actions)
}

function openPopover(state: State, id: string, rect: DOMRect): void {
  closePopover(state)
  const anchor = state.anchors.get(id)
  if (!anchor) return
  const title = anchor.text.length > 90 ? `${anchor.text.slice(0, 90)}…` : anchor.text
  const popover = el('div', { className: 'cm-pop' }, el('h4', { textContent: title }), ...thread(state, forAnchor(state, id)), form(state, id, anchor.text))
  document.body.appendChild(popover)
  const viewport = document.documentElement.clientWidth
  popover.style.top = `${window.scrollY + rect.bottom + 6}px`
  popover.style.left = `${window.scrollX + Math.max(8, Math.min(rect.right - popover.offsetWidth, viewport - popover.offsetWidth - 8))}px`
  popover.querySelector('textarea')?.focus()
  state.popover = popover
}

const openPanel = (state: State): void => {
  const orphans = state.comments.filter((c) => !state.anchors.has(c.anchor))
  const groups = [...state.anchors].filter(([id]) => forAnchor(state, id).length > 0)
  const header = el(
    'div',
    { className: 'cm-row' },
    el('strong', { textContent: `Comments on this page (${state.comments.length})` }),
    button('Close', 'cm-ghost', () => closePanel(state)),
  )
  const agents = el('p', {}, el('a', { href: `${API}.md?page=${encodeURIComponent(page)}`, target: '_blank', textContent: 'Markdown for agents' }))
  const grouped = groups.flatMap(([id, anchor]) => [
    el('div', { className: 'cm-quote' }, link(anchor.text.slice(0, 120), () => anchor.node.scrollIntoView({ behavior: 'smooth', block: 'center' }))),
    ...thread(state, forAnchor(state, id)),
  ])
  const orphaned = orphans.flatMap((c) => [el('div', { className: 'cm-quote', textContent: c.anchorText }), ...thread(state, [c])])
  const orphanTitle = orphans.length > 0 ? el('h3', { textContent: 'Comments on changed text' }) : null
  state.panel = el('aside', { className: 'cm-panel' }, header, agents, ...grouped, orphanTitle, ...orphaned)
  document.body.appendChild(state.panel)
}

// ---------- wiring ----------

const attachButtons = (state: State): void => {
  for (const [id, { node }] of state.anchors) {
    node.classList.add('cm-host')
    const btn = el('button', { className: 'cm-btn', type: 'button', title: 'Comment', textContent: '💬' })
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
    selectButton: el('button', { className: 'cm-sel', type: 'button', textContent: '💬 Comment on selection' }),
    glow: el('style'),
    comments: [],
    popover: null,
    panel: null,
    selected: null,
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
