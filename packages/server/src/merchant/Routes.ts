import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import { Address } from '@ethmumbai/protocol/Hex'
import { Effect, Layer, Option } from 'effect'
import type { Payees } from './Catalogue.ts'
import { GateSeed, gateKeyRoute, makeGateSigner } from './GateKey.ts'
import { invoiceRoutes } from './Invoices.ts'
import { statusRoute } from './Status.ts'
import { type Settlement, x402Routes } from './X402.ts'
import { type Bindings, optionalBinding } from '../Respond.ts'

/** The merchant's optional bindings: each missing one turns only its own routes into 503s. */
export const merchantPayees = (env: Bindings) =>
  Effect.gen(function* () {
    const merchant = yield* optionalBinding(env, 'MERCHANT_PAY_TO', Address)
    const restricted = yield* optionalBinding(env, 'RESTRICTED_PAY_TO', Address)
    return Option.all({ merchant, restricted }) satisfies Option.Option<Payees>
  })

/** Catalogue, invoices, x402 and the gate (spec §7), merged into the API Worker's router. */
export const merchantRoutes = Effect.fn('EthMumbai.Merchant.routes')(function* (
  database: QueryDatabaseClient,
  env: Bindings,
  origin: string,
  settlement: Option.Option<Settlement>,
  payees: Option.Option<Payees>,
) {
  const seed = yield* optionalBinding(env, 'GATE_ED25519_SEED', GateSeed)
  const signer = Option.isSome(seed) ? Option.some(yield* makeGateSigner(seed.value)) : Option.none()
  return Layer.mergeAll(
    invoiceRoutes(database, origin, payees),
    x402Routes(database, origin, settlement),
    statusRoute(database, signer),
    gateKeyRoute(signer),
  )
})
