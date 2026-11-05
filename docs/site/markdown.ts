/**
 * A page's comments as markdown, for agents: grouped by anchor, open threads first, replies indented under the comment
 * they answer, and each thread's status on its root.
 */
import type { Comment } from './threads.ts'

const openFirst = (left: Comment, right: Comment) =>
  Number(left.status !== 'open') - Number(right.status !== 'open') || left.createdAt.localeCompare(right.createdAt)

const statusLabel = (root: Comment) =>
  root.status === 'open' ? '[open]' : `[${root.status}${root.statusBy === null ? '' : ` by ${root.statusBy}`}]`

const line = (comment: Comment, depth: number, label: string) =>
  `${'  '.repeat(depth)}- ${label}**${comment.name}** (${comment.createdAt}): ${comment.body.replaceAll(
    '\n',
    `\n${'  '.repeat(depth + 1)}`,
  )}`

const threadLines = (comment: Comment, depth: number, children: ReadonlyMap<string, Comment[]>): string[] => [
  line(comment, depth, depth === 0 ? `${statusLabel(comment)} ` : ''),
  ...(children.get(comment.id) ?? []).flatMap((reply) => threadLines(reply, depth + 1, children)),
]

export const asMarkdown = (page: string, all: readonly Comment[]): string => {
  const children = new Map<string, Comment[]>()
  for (const comment of all)
    if (comment.parentId !== null) children.set(comment.parentId, [...(children.get(comment.parentId) ?? []), comment])
  const roots = all.filter((comment) => comment.parentId === null).toSorted(openFirst)
  const byAnchor = new Map<string, Comment[]>()
  for (const root of roots) byAnchor.set(root.anchor, [...(byAnchor.get(root.anchor) ?? []), root])
  const sections = [...byAnchor.values()].map((threads) => {
    const first = threads[0]
    const heading = `## ${first?.anchorText || first?.anchor} \`#${first?.anchor}\``
    return [heading, '', ...threads.flatMap((root) => threadLines(root, 0, children))].join('\n')
  })
  const open = roots.filter((root) => root.status === 'open').length
  return `# Comments on /${page}/ (${all.length} comments, ${open} of ${roots.length} threads open)\n\n${sections.join('\n\n')}\n`
}
