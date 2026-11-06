import { AssertionOptions, type AssertionRequest } from '@ethmumbai/auth/config'
import { Schema } from 'effect'
import { getJson, postJson } from './Http.ts'

/** The browser's view of the wallet API (packages/server/src/wallet): only the fields the pages show. */

const Nullable = <S extends Schema.Constraint>(schema: S) => Schema.NullOr(schema)

export const GrantView = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  dailyCap: Schema.String,
  perPaymentCap: Schema.String,
  allowlist: Schema.Array(Schema.String),
  expiresAt: Schema.Number,
  revokeTx: Schema.optionalKey(Nullable(Schema.String)),
})
export type GrantView = typeof GrantView.Type

export const WalletView = Schema.Struct({
  account: Schema.Struct({
    accountId: Schema.String,
    displayName: Schema.String,
    smartAccount: Schema.String,
    deployStatus: Schema.String,
    deployTx: Nullable(Schema.String),
  }),
  balance: Nullable(Schema.Struct({ units: Schema.String, usdc: Schema.String })),
  fund: Schema.Struct({ network: Schema.String, asset: Schema.String, address: Schema.String }),
})
export type WalletView = typeof WalletView.Type

export const EpisodeActivity = Schema.Struct({
  id: Schema.String,
  robotId: Schema.String,
  robotName: Schema.String,
  item: Schema.String,
  state: Schema.String,
  createdAt: Schema.Number,
  amount: Nullable(Schema.String),
  txHash: Nullable(Schema.String),
})
export type EpisodeActivity = typeof EpisodeActivity.Type

export const ActivityView = Schema.Struct({
  episodes: Schema.Array(EpisodeActivity),
  grants: Schema.Array(Schema.Struct({ ...GrantView.fields, robotId: Schema.String })),
})
export type ActivityView = typeof ActivityView.Type

export const RobotView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: Schema.String,
  chipAddress: Nullable(Schema.String),
  pairingCode: Nullable(Schema.String),
  pairingExpiresAt: Nullable(Schema.Number),
  lease: Schema.Struct({ until: Nullable(Schema.Number), online: Schema.Boolean }),
  grant: Nullable(GrantView),
})
export type RobotView = typeof RobotView.Type

export const AddedRobot = Schema.Struct({
  robotId: Schema.String,
  name: Schema.String,
  pairingCode: Schema.String,
  pairingExpiresAt: Schema.Number,
})
export type AddedRobot = typeof AddedRobot.Type

/** A passkey prompt for an owner action: the challenge is the delegation's EIP-712 digest. */
const OwnerPrompt = Schema.Struct({
  ...AssertionOptions.fields,
  grantId: Schema.String,
  allowCredentials: Schema.Array(Schema.String),
})

export const loadWallet = getJson('/api/wallet', WalletView)
export const loadActivity = getJson('/api/wallet/activity', ActivityView)
export const listRobots = getJson('/api/robots', Schema.Struct({ robots: Schema.Array(RobotView) }))
export const addRobot = (name: string) => postJson('/api/robots', { name }, AddedRobot)

export type GrantTerms = {
  readonly robotId: string
  readonly dailyCap: string
  readonly perPaymentCap: string
  readonly allowlist: ReadonlyArray<string>
  readonly expiresAt: number
}
export const grantOptions = (terms: GrantTerms) => postJson('/api/wallet/grants/options', terms, OwnerPrompt)
export const signGrant = (grantId: string, assertion: AssertionRequest) =>
  postJson(
    `/api/wallet/grants/${grantId}/sign`,
    assertion,
    Schema.Struct({ grantId: Schema.String, status: Schema.String, deployTx: Nullable(Schema.String) }),
  )
export const revokeOptions = (grantId: string) =>
  postJson(`/api/wallet/grants/${grantId}/revoke/options`, {}, OwnerPrompt)
export const signRevoke = (grantId: string, assertion: AssertionRequest) =>
  postJson(
    `/api/wallet/grants/${grantId}/revoke/sign`,
    assertion,
    Schema.Struct({ grantId: Schema.String, status: Schema.String, revokeTx: Schema.String }),
  )

export const Catalogue = Schema.Struct({
  merchantId: Schema.String,
  payTo: Schema.optionalKey(Nullable(Schema.String)),
  items: Schema.Array(
    Schema.Struct({ itemId: Schema.String, name: Schema.String, amount: Schema.String, restricted: Schema.Boolean }),
  ),
})
export type Catalogue = typeof Catalogue.Type
export const loadCatalogue = getJson('/api/merchants/duck-cafe/items', Catalogue)

/** USDC base units (6 dp) as "0.10". */
export const usdc = (units: string): string => {
  const value = BigInt(units)
  const whole = value / 1_000_000n
  const fraction = (value % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '').padEnd(2, '0')
  return `${whole}.${fraction}`
}

export const explorerTx = (hash: string) => `https://explorer.arc.io/tx/${hash}`
export const explorerAddress = (address: string) => `https://explorer.arc.io/address/${address}`
