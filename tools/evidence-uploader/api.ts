// The uploader's side of the Worker's evidence queue (spec §6): claim pending episodes, then report each one uploaded
// or failed. Every call carries the bearer token; nothing here prints it.

export type Pending = { readonly episodeId: string; readonly requestIdsHash: string; readonly payloadJson: string }
export type Uploaded = { readonly rootHash: string; readonly storageTx: string; readonly logTx: string }
/** A chip-signed frame not yet on 0G Storage (the backfill). */
export type PendingFrame = { readonly episodeId: string; readonly sha256: string }
export type FrameStored = { readonly rootHash: string; readonly storageTx: string }
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

const isPendingFrame = (value: unknown): value is PendingFrame =>
  typeof value === 'object' &&
  value !== null &&
  'episodeId' in value &&
  typeof value.episodeId === 'string' &&
  'sha256' in value &&
  typeof value.sha256 === 'string'

const framePath = (episodeId: string, sha256: string) => `/api/evidence/${episodeId}/frames/${sha256}`

/** The server keeps at most 500 characters of a failure reason. */
const MAX_REASON = 400

export const makeEvidenceApi = (server: string, token: string, fetcher: Fetch = fetch) => {
  /** GET without a body, POST with a JSON body; the response as it came. */
  const send = async (path: string, body?: unknown) => {
    const method = body === undefined ? 'GET' : 'POST'
    const response = await fetcher(`${server}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}`)
    return response
  }
  const call = async (path: string, body?: unknown) => {
    const reply: unknown = await (await send(path, body)).json()
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
    pendingFrames: async (): Promise<PendingFrame[]> => {
      const body = await call('/api/evidence/frames/pending')
      const frames = typeof body === 'object' && body !== null && 'frames' in body ? body.frames : []
      return Array.isArray(frames) ? frames.filter(isPendingFrame) : []
    },
    /** The frame's exact bytes as R2 holds them. */
    readFrame: async (episodeId: string, sha256: string) =>
      new Uint8Array(await (await send(framePath(episodeId, sha256))).arrayBuffer()),
    /** Reports the frame's 0G root; answers the episode's evidence JSON with the root in it while the episode is not
     *  on 0G yet (the JSON to upload), else null. */
    markFrameUploaded: async (episodeId: string, sha256: string, stored: FrameStored) => {
      const body = await call(framePath(episodeId, sha256), stored)
      const payloadJson = typeof body === 'object' && body !== null && 'payloadJson' in body ? body.payloadJson : null
      return typeof payloadJson === 'string' ? payloadJson : null
    },
  }
}
