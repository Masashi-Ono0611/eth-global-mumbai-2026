// The uploader's side of the Worker's evidence queue (spec §6): claim pending episodes, then report each one uploaded
// or failed. Every call carries the bearer token; nothing here prints it.

export type Pending = { readonly episodeId: string; readonly requestIdsHash: string; readonly payloadJson: string }
export type Uploaded = { readonly rootHash: string; readonly storageTx: string; readonly logTx: string }
type Fetch = (input: string, init: RequestInit) => Promise<Response>

const isPending = (value: unknown): value is Pending =>
  typeof value === 'object' &&
  value !== null &&
  'episodeId' in value &&
  typeof value.episodeId === 'string' &&
  'requestIdsHash' in value &&
  typeof value.requestIdsHash === 'string' &&
  'payloadJson' in value &&
  typeof value.payloadJson === 'string'

/** The server keeps at most 500 characters of a failure reason. */
const MAX_REASON = 400

export const makeEvidenceApi = (server: string, token: string, fetcher: Fetch = fetch) => {
  /** GET without a body, POST with a JSON body. */
  const call = async (path: string, body?: unknown) => {
    const method = body === undefined ? 'GET' : 'POST'
    const response = await fetcher(`${server}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}`)
    const reply: unknown = await response.json()
    return reply
  }
  return {
    claimPending: async (): Promise<Pending[]> => {
      const body = await call('/api/evidence/pending')
      const episodes = typeof body === 'object' && body !== null && 'episodes' in body ? body.episodes : []
      return Array.isArray(episodes) ? episodes.filter(isPending) : []
    },
    markUploaded: (episodeId: string, uploaded: Uploaded) => call(`/api/evidence/${episodeId}/uploaded`, uploaded),
    /** `{error}` is the whole body (the server answers 400 to anything else, and the failure would go unrecorded). */
    markFailed: (episodeId: string, reason: string) =>
      call(`/api/evidence/${episodeId}/failed`, { error: reason.slice(0, MAX_REASON) }),
  }
}
