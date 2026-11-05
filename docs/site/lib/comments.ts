/**
 * Login-free comments for docs/site pages. The site build compiles this file to /lib/comments.js.
 *
 * Opt in with <script src="/lib/comments.js" defer></script>. Every heading, card, table row, list item, callout and
 * diagram gets a 💬 on hover (an element inside another commentable element doesn't get its own). Comments are stored
 * by the site Worker (/api/comments, D1), keyed by page slug and an anchor built from the element's section and text.
 * No login and no code: your name is asked once and kept in localStorage. If an element's text changes, its comments
 * move to "Comments on changed text" in the panel. Agents read everything at /api/comments.md?page=<slug>.
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
  readonly node: HTMLElement
  readonly text: string
}

interface State {
  readonly anchors: ReadonlyMap<string, Anchor>
  readonly buttons: Map<string, HTMLButtonElement>
  readonly fab: HTMLButtonElement
  comments: ReadonlyArray<Comment>
  popover: HTMLElement | null
  panel: HTMLElement | null
}

const API = '/api/comments'
const SELECTOR =
  'main h1, main h2, main h3, main .card, main .rule, main tr, main li, main .diagram, main details > summary, main p.lead'
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
  @media (hover: none) { .cm-btn { opacity: .55; } }
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

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

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
    anchors.set(id, { node: hostOf(node), text: textOf(node).slice(0, 160) })
  }
  return anchors
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

const render = (state: State): void => {
  for (const [id, btn] of state.buttons) {
    const count = forAnchor(state, id).length
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

const openPopover = (state: State, id: string, anchorButton: HTMLElement): void => {
  closePopover(state)
  const anchor = state.anchors.get(id)
  if (!anchor) return
  const title = anchor.text.length > 90 ? `${anchor.text.slice(0, 90)}…` : anchor.text
  const popover = el('div', { className: 'cm-pop' }, el('h4', { textContent: title }), ...thread(state, forAnchor(state, id)), form(state, id, anchor.text))
  document.body.appendChild(popover)
  const rect = anchorButton.getBoundingClientRect()
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
      openPopover(state, id, btn)
    })
    node.appendChild(btn)
    state.buttons.set(id, btn)
  }
}

const listenGlobally = (state: State): void => {
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    closePopover(state)
    closePanel(state)
  })
  document.addEventListener('click', (event) => {
    const target = event.target
    const onButton = target instanceof HTMLElement && target.classList.contains('cm-btn')
    if (state.popover && target instanceof Node && !state.popover.contains(target) && !onButton) closePopover(state)
  })
  state.fab.addEventListener('click', () => (state.panel ? closePanel(state) : openPanel(state)))
}

const start = (): void => {
  document.head.appendChild(el('style', { textContent: css }))
  const state: State = {
    anchors: collectAnchors(),
    buttons: new Map(),
    fab: el('button', { className: 'cm-fab', type: 'button' }),
    comments: [],
    popover: null,
    panel: null,
  }
  document.body.appendChild(state.fab)
  attachButtons(state)
  listenGlobally(state)
  render(state)
  refresh(state)
}

start()
