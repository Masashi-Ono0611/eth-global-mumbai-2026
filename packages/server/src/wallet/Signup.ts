import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import type { VerifiedPasskey } from '@ethmumbai/auth'
import { counterfactualAccount } from '@ethmumbai/chain'
import { Clock, Effect } from 'effect'
import { newSecurityRevision } from '../auth/Session.ts'
import { createAccount } from '../auth/Store.ts'

/** Creates the account for a verified new passkey: the counterfactual address is known (and shown) before any
 * transaction; the relayer deploys it with the first grant. */
export const signup = Effect.fn('EthMumbai.Wallet.signup')(function* (
  database: QueryDatabaseClient,
  input: { readonly accountId: string; readonly displayName: string; readonly passkey: VerifiedPasskey },
) {
  const { passkey } = input
  // The HybridDeleGator before it exists: CREATE2 over deployParams [0x0, [keyId], [x], [y]] and
  // deploySalt = keccak256(utf8(accountId)) (spec §4); offline, no RPC.
  const owner = yield* counterfactualAccount({
    accountId: input.accountId,
    keyId: passkey.credentialId,
    x: passkey.x,
    y: passkey.y,
  })
  const securityRevision = yield* newSecurityRevision
  yield* createAccount(database, {
    accountId: input.accountId,
    displayName: input.displayName,
    securityRevision,
    smartAccount: owner.smartAccount,
    deploySalt: owner.deploySalt,
    credentialId: passkey.credentialId,
    alg: passkey.alg,
    spki: passkey.spki,
    x: passkey.x,
    y: passkey.y,
    signCount: passkey.signCount,
    nowMillis: yield* Clock.currentTimeMillis,
  })
  return { accountId: input.accountId, smartAccount: owner.smartAccount, securityRevision }
})
