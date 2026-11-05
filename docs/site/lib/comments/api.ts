import { API, type PageComment, type Status, page } from './types'

// ---------- API ----------

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

export const STATUSES: ReadonlyArray<Status> = ['open', 'resolved', 'accepted', 'rejected']

export const isStatus = (value: unknown): value is Status => STATUSES.some((status) => status === value)

export const stringOrNull = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)

/** Older servers return no parentId/status: those comments are open, top-level threads. */
export const toComment = (value: unknown): PageComment | null => {
  if (!isRecord(value)) return null
  const { id, anchor, anchorText, name, body, createdAt } = value
  if (typeof id !== 'string' || typeof anchor !== 'string' || typeof anchorText !== 'string') return null
  if (typeof name !== 'string' || typeof body !== 'string' || typeof createdAt !== 'string') return null
  const status = isStatus(value['status']) ? value['status'] : 'open'
  return { id, anchor, anchorText, name, body, createdAt, parentId: stringOrNull(value['parentId']), status, statusBy: stringOrNull(value['statusBy']) }
}

export const send = async (path: string, init?: RequestInit): Promise<unknown> => {
  const res = await fetch(path, init)
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => '')}`.trim())
  return res.status === 204 ? null : res.json()
}

export const fetchComments = async (): Promise<ReadonlyArray<PageComment>> => {
  const body = await send(`${API}?page=${encodeURIComponent(page)}`)
  return Array.isArray(body) ? body.map(toComment).filter((c): c is PageComment => c !== null) : []
}

export const postComment = (draft: { readonly anchor: string; readonly anchorText: string; readonly parentId: string | null; readonly name: string; readonly body: string }): Promise<unknown> =>
  send(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ page, ...draft }),
  })

export const patchStatus = (id: string, status: Status, by: string): Promise<unknown> =>
  send(`${API}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status, by }),
  })

export const deleteComment = (id: string): Promise<unknown> =>
  send(`${API}/${encodeURIComponent(id)}`, { method: 'DELETE' })
