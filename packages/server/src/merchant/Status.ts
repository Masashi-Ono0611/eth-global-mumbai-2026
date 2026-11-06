import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { Effect, Option, Schema } from 'effect'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpRouter from 'effect/http/HttpRouter'
import type { GateSigner } from './GateKey.ts'
import { type InvoiceStatus, readInvoice } from './Invoices.ts'
import { json, jsonError, notConfigured, nowSeconds } from '../Respond.ts'
import { changes } from '../Sql.ts'

/** The gate's challenge: at most 32 characters and no `|`, so the signed message stays unambiguous. */
const StatusQuery = Schema.Struct({ nonce: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,32}$/)) })

/** The exact bytes the gate verifies: UTF-8 `<invoiceId>|<status>|<nonce>|<expiresAt>`. */
export const statusMessage = (invoiceId: string, status: InvoiceStatus, nonce: string, expiresAt: number) =>
  `${invoiceId}|${status}|${nonce}|${expiresAt}`

/**
 * The first read that sees `paid` wins the conditional update and reports `paid`; every later read reports `used`,
 * so one payment opens the gate once.
 */
const consumePaid = Effect.fnUntraced(function* (database: QueryDatabaseClient, invoiceId: string) {
  const now = yield* nowSeconds
  const won = yield* changes(
    database
      .prepare(`UPDATE invoices SET status = 'used', used_at = ? WHERE id = ? AND status = 'paid'`)
      .bind(now, invoiceId),
  )
  return won === 1 ? ('paid' as const) : ('used' as const)
})

/** `GET /api/invoices/:id/status?nonce=` → Ed25519-signed `{invoiceId, status, nonce, expiresAt, sig}`. */
export const statusRoute = (database: QueryDatabaseClient, signer: Option.Option<GateSigner>) =>
  HttpRouter.add(
    'GET',
    '/api/invoices/:invoiceId/status',
    Effect.gen(function* () {
      if (Option.isNone(signer)) return yield* notConfigured('GATE_ED25519_SEED')
      const query = yield* HttpServerRequest.schemaSearchParams(StatusQuery).pipe(Effect.option)
      if (Option.isNone(query)) return yield* jsonError(400, 'nonce must be 1-32 characters of [A-Za-z0-9_-]')
      const { invoiceId } = yield* HttpRouter.params
      const found = yield* readInvoice(database, invoiceId ?? '')
      if (Option.isNone(found)) return yield* jsonError(404, 'unknown invoice')
      const invoice = found.value
      const status = invoice.status === 'paid' ? yield* consumePaid(database, invoice.id) : invoice.status
      const { nonce } = query.value
      const sig = yield* signer.value.sign(statusMessage(invoice.id, status, nonce, invoice.expires_at))
      return yield* json({ invoiceId: invoice.id, status, nonce, expiresAt: invoice.expires_at, sig }, 200, {
        'cache-control': 'no-store',
      })
    }),
  )
