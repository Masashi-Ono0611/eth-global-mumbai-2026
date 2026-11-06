import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { Effect } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'

/** Test-only D1 writes the merchant acceptance needs (RuntimeWorker mounts them under `/test/merchant/`). */
export const merchantFixtureRoutes = (database: QueryDatabaseClient) =>
  HttpRouter.add(
    'POST',
    '/test/merchant/invoices/:invoiceId/force-paid',
    Effect.gen(function* () {
      const { invoiceId } = yield* HttpRouter.params
      const result = yield* database
        .prepare(`UPDATE invoices SET status = 'paid', paid_tx = ? WHERE id = ? AND status = 'pending'`)
        .bind(`0x${'ab'.repeat(32)}`, invoiceId ?? '')
        .run()
      return HttpServerResponse.empty({ status: result.meta.changes === 1 ? 204 : 404 })
    }),
  )
