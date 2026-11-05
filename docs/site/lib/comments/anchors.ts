import { type Anchor, SELECTOR } from './types.ts'
import { textOf } from './dom.ts'

// ---------- anchors: which elements can be commented on ----------

export const hash = (text: string): string => {
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
export const collectAnchors = (): Map<string, Anchor> => {
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

export const ownersOf = (anchors: ReadonlyMap<string, Anchor>): Map<Element, string> => {
  const owners = new Map<Element, string>()
  for (const [id, anchor] of anchors) {
    owners.set(anchor.source, id)
    owners.set(anchor.node, id)
  }
  return owners
}
