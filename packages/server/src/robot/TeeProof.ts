import { TeeProof } from '@ethmumbai/protocol/Errand'
import { Address, type Hex, HexBytes } from '@ethmumbai/protocol/Hex'
import { Clock, Effect, Option, Schema } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'
import { createPublicClient, http, isAddressEqual, parseAbi, recoverMessageAddress } from 'viem'
import type { ZeroGOutcome } from './ZeroGClient.ts'

// The TEE proof of a 0G decision. A TeeML provider's TEE signs every chat it serves, and the 0G Compute inference
// contract names the signing address. Right after a decision we read the provider's service (one eth_call) and fetch
// the signature for the chat id (one GET), 5 s each and no retry, because the provider serves it for about 20 minutes
// only. This mirrors SDK 0.9.0 `ResponseProcessor.processResponse`. A missing proof means "no proof": it never changes
// the decision.

/** 0G mainnet (chain 16661), where the router's providers are registered (SDK 0.9.0 `CONTRACT_ADDRESSES.mainnet`). */
export const ZG_COMPUTE_RPC_DEFAULT = 'https://evmrpc.0g.ai'
export const ZG_INFERENCE_CONTRACT_DEFAULT: Hex = '0x47340d900bdFec2BD393c626E12ea0656F938d84'

/** Where the provider registry lives: `ZG_COMPUTE_RPC` and `ZG_INFERENCE_CONTRACT`, mainnet by default. */
export interface TeeRegistry {
  readonly rpcUrl: string
  readonly inference: Hex
}

const servingAbi = parseAbi([
  'struct Service { address provider; string serviceType; string url; uint256 inputPrice; uint256 outputPrice; uint256 updatedAt; string model; string verifiability; string additionalInfo; address teeSignerAddress; bool teeSignerAcknowledged; }',
  'function getService(address provider) view returns (Service service)',
])

const AdditionalInfo = Schema.fromJsonString(
  Schema.Struct({
    ProviderType: Schema.optionalKey(Schema.String),
    TargetSeparated: Schema.optionalKey(Schema.Boolean),
    TargetTeeAddress: Schema.optionalKey(Schema.String),
  }),
)

/** @internal The registry fields that decide the signer (exported for the unit test). */
export interface ServiceSigning {
  readonly verifiability: string
  readonly additionalInfo: string
  readonly teeSignerAddress: Hex
  readonly teeSignerAcknowledged: boolean
}

/**
 * The address that signs this service's replies, by the SDK's rule. For a separated decentralized provider it is the
 * LLM's own TEE (`additionalInfo.TargetTeeAddress`); otherwise it is the broker TEE's `teeSignerAddress`, which a
 * centralized provider also uses. `None` when the service is not TeeML, its signer is not acknowledged, or its
 * additionalInfo does not parse.
 *
 * @internal Exported for the unit test.
 */
export const signingAddressOf = (service: ServiceSigning): Option.Option<Hex> => {
  if (service.verifiability !== 'TeeML' || !service.teeSignerAcknowledged) return Option.none()
  return Option.flatMap(Schema.decodeUnknownOption(AdditionalInfo)(service.additionalInfo), (info) => {
    const centralized = info.ProviderType === 'centralized'
    const target = info.TargetTeeAddress ?? ''
    return info.TargetSeparated === true && !centralized && target !== ''
      ? Schema.decodeUnknownOption(Address)(target)
      : Option.some(service.teeSignerAddress)
  })
}

/** Does `signature` (EIP-191 over `text`) recover to `signer`? A malformed signature is `false`. */
export const teeSignerMatches = (proof: { readonly text: string; readonly signature: Hex; readonly signer: Hex }) =>
  Effect.tryPromise(() => recoverMessageAddress({ message: proof.text, signature: proof.signature })).pipe(
    Effect.map((recovered) => isAddressEqual(recovered, proof.signer)),
    Effect.orElseSucceed(() => false),
  )

const readService = (registry: TeeRegistry, provider: Hex) =>
  Effect.tryPromise(() =>
    createPublicClient({ transport: http(registry.rpcUrl, { timeout: 5_000, retryCount: 0 }) }).readContract({
      address: registry.inference,
      abi: servingAbi,
      functionName: 'getService',
      args: [provider],
    }),
  ).pipe(Effect.timeout('5 seconds'), Effect.option)

const SignatureReply = Schema.Struct({
  text: Schema.String,
  signature: HexBytes,
  /** The address the provider says signed (it should be the registry's signer; `verified` is what counts). */
  signing_address: Schema.optionalKey(Address),
})

/** `GET {service.url}/v1/proxy/signature/{chatId}?model={model}` → `{text, signature}`. */
const fetchSignature = (serviceUrl: string, chatId: string, model: string) =>
  HttpClient.get(
    `${serviceUrl.replace(/\/+$/, '')}/v1/proxy/signature/${encodeURIComponent(chatId)}?model=${encodeURIComponent(model)}`,
  ).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap((response) => response.json),
    Effect.flatMap(Schema.decodeUnknownEffect(SignatureReply)),
    Effect.timeout('5 seconds'),
    Effect.option,
  )

const noProof = (why: string) =>
  Effect.logWarning(`0G TEE proof unavailable: ${why}`).pipe(Effect.as(Option.none<TeeProof>()))

/**
 * The provider TEE's signature for a successful decision's chat, checked against the registry's signer. `None` for a
 * failed decision, a reply without a chat id or provider, or any step that does not answer in time.
 */
export const proveDecision = Effect.fnUntraced(function* (registry: TeeRegistry, outcome: ZeroGOutcome) {
  const { chatId, routedTo } = outcome.call
  const provider = Option.getOrUndefined(Schema.decodeUnknownOption(Address)(routedTo))
  if (!outcome.ok || chatId === null || provider === undefined) return Option.none<TeeProof>()
  const service = yield* readService(registry, provider)
  if (Option.isNone(service)) return yield* noProof('the provider registry did not answer')
  const signer = signingAddressOf(service.value)
  if (Option.isNone(signer)) return yield* noProof('the provider is not a verifiable TeeML service')
  const reply = yield* fetchSignature(service.value.url, chatId, service.value.model)
  if (Option.isNone(reply)) return yield* noProof('the provider did not serve the signature')
  const proof = { signer: signer.value, text: reply.value.text, signature: reply.value.signature }
  return Option.some<TeeProof>({
    ...proof,
    signingAddress: reply.value.signing_address ?? signer.value,
    serviceUrl: service.value.url,
    fetchedAt: yield* Clock.currentTimeMillis,
    verified: yield* teeSignerMatches(proof),
  })
})

/** `decisions.tee_json`: the proof as the protocol encodes it; `null` without one. */
export const encodeTeeProof = (proof: Option.Option<TeeProof>) =>
  Option.match(proof, {
    onNone: () => Effect.succeed(null),
    onSome: (present) => Schema.encodeEffect(Schema.fromJsonString(TeeProof))(present).pipe(Effect.orDie),
  })

/** The stored proof back, or `None` (no proof, or a row this code did not write). */
export const decodeTeeProof = (teeJson: string | null) =>
  teeJson === null ? Option.none<TeeProof>() : Schema.decodeUnknownOption(Schema.fromJsonString(TeeProof))(teeJson)
