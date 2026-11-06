import { type HybridDeleGatorDeployParams, Implementation } from '@metamask/smart-accounts-kit'
import { getCounterfactualAccountData } from '@metamask/smart-accounts-kit/utils'
import { Effect } from 'effect'
import { type Address, getAddress, type Hex, keccak256, stringToHex, zeroAddress } from 'viem'
import { arcEnvironment } from './Env.ts'

export type OwnerKey = {
  /** The owner's account id (26-char base32); the deploy salt is `keccak256(utf8(accountId))`. */
  readonly accountId: string
  /** The passkey credential id (base64url), the Hybrid's P-256 `keyId`. */
  readonly keyId: string
  /** P-256 public key coordinates, `0x` hex or decimal. */
  readonly x: string
  readonly y: string
  /** Optional EOA owner (the passkey fallback). */
  readonly eoaOwner?: Address
}

export type CounterfactualOwner = {
  readonly smartAccount: Address
  readonly deploySalt: Hex
  /** `SimpleFactory` call that deploys the account: the relayer sends `{ to: factory, data: factoryData }`. */
  readonly factory: Address
  readonly factoryData: Hex
}

export const deploySaltOf = (accountId: string): Hex => keccak256(stringToHex(accountId))

const computeOwner = Effect.fn('EthMumbai.Chain.counterfactualOwner')(function* (
  accountId: string,
  deployParams: HybridDeleGatorDeployParams,
) {
  const deploySalt = deploySaltOf(accountId)
  const data = yield* Effect.promise(() =>
    getCounterfactualAccountData({
      factory: arcEnvironment.SimpleFactory,
      implementations: arcEnvironment.implementations,
      implementation: Implementation.Hybrid,
      deployParams,
      deploySalt,
    }),
  )
  const owner: CounterfactualOwner = {
    smartAccount: getAddress(data.address),
    deploySalt,
    factory: arcEnvironment.SimpleFactory,
    factoryData: data.factoryData,
  }
  return owner
})

/**
 * The owner's HybridDeleGator before it exists (CREATE2 from SimpleFactory over the Hybrid proxy initcode with
 * `deployParams [eoaOwner ?? 0x0, [keyId], [x], [y]]`). No RPC: the kit computes it from the deployment registry.
 */
export const counterfactualAccount = (key: OwnerKey) =>
  computeOwner(key.accountId, [key.eoaOwner ?? zeroAddress, [key.keyId], [BigInt(key.x)], [BigInt(key.y)]])

/** An EOA-only Hybrid (no passkey): the smoke test's owner and the passkey-less fallback. */
export const counterfactualEoaAccount = (accountId: string, eoaOwner: Address) =>
  computeOwner(accountId, [eoaOwner, [], [], []])
