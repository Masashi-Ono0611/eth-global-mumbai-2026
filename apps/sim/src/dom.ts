// A small element builder for the simulator's overlay (plain DOM beside the vendored React engine). Classes are
// whole Tailwind utility strings, so Tailwind's scanner sees every one of them.

export type Child = Node | string

// `appendChild`, not `append`: the Workers types in the shared tsconfig redeclare Element.append for HTMLRewriter.
const appendAll = (parent: Node, children: ReadonlyArray<Child>) => {
  for (const child of children) parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child)
}

export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  children: ReadonlyArray<Child> = [],
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className !== '') node.className = className
  appendAll(node, children)
  return node
}

export const link = (href: string, className: string, text: string) => {
  const anchor = el('a', className, [text])
  anchor.href = href
  anchor.target = '_blank'
  anchor.rel = 'noreferrer'
  return anchor
}
