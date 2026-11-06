import { Option, Schema } from 'effect'

// HTTP to the app's own origin (the page is served from it, so cookies and Origin are first-party). Every response
// is decoded with an explicit schema; a failure carries the status and the server's `error` text, never a body dump.

export type Reply<A> =
  | { readonly ok: true; readonly status: number; readonly value: A }
  | { readonly ok: false; readonly status: number; readonly error: string }

const ErrorBody = Schema.Struct({ error: Schema.String })

export type Fetcher = (path: string, init?: RequestInit) => Promise<Response>

/** Same-origin fetch with the owner's session cookie. */
export const ownerFetch: Fetcher = (path, init) => fetch(path, { credentials: 'same-origin', ...init })

export const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export const request = async <S extends Schema.Constraint & Schema.ConstraintDecoder<unknown>>(
  fetcher: Fetcher,
  path: string,
  schema: S,
  init?: RequestInit,
): Promise<Reply<S['Type']>> => {
  const response = await fetcher(path, init).catch(() => null)
  if (response === null) return { ok: false, status: 0, error: 'network error' }
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = Option.match(Schema.decodeUnknownOption(ErrorBody)(body), {
      onNone: () => response.statusText,
      onSome: (decoded) => decoded.error,
    })
    return { ok: false, status: response.status, error: message }
  }
  return Option.match(Schema.decodeUnknownOption(schema)(body), {
    onNone: (): Reply<S['Type']> => ({ ok: false, status: response.status, error: 'unexpected response shape' }),
    onSome: (value): Reply<S['Type']> => ({ ok: true, status: response.status, value }),
  })
}

/** `GET /api/invoices/:id/status?nonce=` (packages/server/src/merchant/Status.ts): the first `paid` read wins. */
export const InvoiceStatusReply = Schema.Struct({
  invoiceId: Schema.String,
  status: Schema.Literals(['pending', 'paid', 'used', 'expired']),
  expiresAt: Schema.Finite,
})

/** `GET /api/robots/:robotId` (owner): the fields the panel shows. */
export const RobotViewReply = Schema.Struct({
  robot: Schema.Struct({ id: Schema.String, name: Schema.String, status: Schema.String }),
  lease: Schema.Struct({ online: Schema.Boolean }),
  grant: Schema.NullOr(Schema.Struct({ status: Schema.String, dailyCap: Schema.String, perPaymentCap: Schema.String })),
})
export type RobotViewReply = typeof RobotViewReply.Type

/** `GET /api/robots/:robotId/errands/:episodeId` (owner): only the Arc payment. */
export const ErrandPaymentReply = Schema.Struct({
  payment: Schema.NullOr(Schema.Struct({ status: Schema.String, txHash: Schema.NullOr(Schema.String) })),
})

/** Fire and forget: a background task's failure is already reported where it happens. */
export const background = (task: Promise<unknown>): void => {
  task.catch(() => undefined)
}

export const explorerTx = (hash: string) => `https://explorer.arc.io/tx/${hash}`

/** USDC base units (6 dp) as a short decimal. */
export const usdc = (units: string) => (Number(units) / 1_000_000).toFixed(2)
