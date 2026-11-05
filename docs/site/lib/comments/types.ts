export type Status = 'open' | 'resolved' | 'accepted' | 'rejected'

export interface PageComment {
  readonly id: string
  readonly anchor: string
  readonly anchorText: string
  readonly name: string
  readonly body: string
  readonly createdAt: string
  /** The comment this one replies to; null for a thread's first comment. */
  readonly parentId: string | null
  /** Meaningful on a thread's first comment. */
  readonly status: Status
  readonly statusBy: string | null
}

export interface Anchor {
  /** Where the 💬 button lives and what the panel scrolls to. */
  readonly node: HTMLElement
  /** The element whose text is the anchor (differs from `node` for table rows and <summary>). */
  readonly source: HTMLElement
  readonly text: string
}

export interface Selected {
  readonly hostId: string
  readonly quote: string
  readonly rect: DOMRect
}

export interface State {
  readonly anchors: Map<string, Anchor>
  readonly owners: Map<Element, string>
  readonly buttons: Map<string, HTMLButtonElement>
  readonly marked: Set<string>
  readonly fab: HTMLButtonElement
  readonly selectButton: HTMLButtonElement
  /** Glow for commented diagram parts, as CSS rules: Pele rewrites its SVG elements' class attributes. */
  readonly glow: HTMLStyleElement
  comments: ReadonlyArray<PageComment>
  popover: HTMLElement | null
  panel: HTMLElement | null
  selected: Selected | null
  popoverAt: { readonly id: string; readonly rect: DOMRect } | null
  showResolved: boolean
}

export const API = '/api/comments'
export const SELECTOR =
  'main h1, main h2, main h3, main .card, main .rule, main tr, main li, main .diagram, main details > summary, main p.lead'
/** Pele diagram parts that can be commented on (all carry a `data-id`). */
export const PART = '.pele-node, .pele-cluster, .pele-edge, .pele-edge-label, .pele-message'
export const QUOTE_MIN = 3
export const QUOTE_MAX = 280
export const page = location.pathname.replace(/^\/|\/$/g, '') || 'index'

export const store = {
  get: (key: 'name'): string => localStorage.getItem(`comments.${key}`) ?? '',
  set: (key: 'name', value: string): void => {
    localStorage.setItem(`comments.${key}`, value)
  },
}
