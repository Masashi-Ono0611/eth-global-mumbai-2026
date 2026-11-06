import { type ChipState, KeyFile, PairingFile, SpentFile, UsedFile } from '@ethmumbai/chip/state'
import { Effect, Option, Schema } from 'effect'

// The sim chip's state in the tab's IndexedDB: the same four records as the Radxa's state directory (key, pairing,
// used invoices, today's spend) behind the same `ChipState` interface. The key is a plain secp256k1 private key
// (WebCrypto has no secp256k1): any script on this origin can read it. Accepted for the team-only proof of concept;
// the tiny Arc caps and revocation bound it. One database per slot (the sim's robot id): D1 keeps a chip address
// unique across robots, so two sim robots in one browser need two keys.

export class IdbError extends Schema.TaggedError<IdbError>()('IdbError', { message: Schema.String }) {}

const STORE = 'chip'

const settle = <A>(pending: IDBRequest<A>) =>
  Effect.callback<A, IdbError>((resume) => {
    pending.addEventListener('success', () => resume(Effect.succeed(pending.result)), { once: true })
    pending.addEventListener('error', () => resume(Effect.fail(new IdbError({ message: String(pending.error) }))), {
      once: true,
    })
  })

const request = <A>(make: () => IDBRequest<A>) => Effect.suspend(() => settle(make()))

const open = (name: string) =>
  Effect.suspend(() => {
    const opening = indexedDB.open(name, 1)
    opening.addEventListener('upgradeneeded', () => opening.result.createObjectStore(STORE), { once: true })
    return settle(opening)
  })

/** The `ChipState` of slot `slot` (one IndexedDB database `vitaquack-sim-chip:<slot>`). */
export const makeIdbState = Effect.fnUntraced(function* (slot: string) {
  const db = yield* open(`vitaquack-sim-chip:${slot}`)
  const store = (mode: IDBTransactionMode) => db.transaction(STORE, mode).objectStore(STORE)

  const read = <A>(key: string, schema: Schema.ConstraintDecoder<A>) =>
    request<unknown>(() => store('readonly').get(key)).pipe(
      Effect.flatMap((value) =>
        value === undefined
          ? Effect.succeed(Option.none<A>())
          : Schema.decodeUnknownEffect(schema)(value).pipe(Effect.asSome),
      ),
    )
  const write = (key: string, value: unknown) => request(() => store('readwrite').put(value, key)).pipe(Effect.asVoid)

  const usedInvoices = read('used', UsedFile).pipe(
    Effect.map(
      (used): ReadonlySet<string> => new Set(Option.getOrElse(used, () => []).map((hash) => hash.toLowerCase())),
    ),
  )
  const spentOn = (day: number) =>
    read('spent', SpentFile).pipe(
      Effect.map((spent) =>
        Option.match(spent, { onNone: () => 0n, onSome: (value) => (value.day === day ? BigInt(value.total) : 0n) }),
      ),
    )

  const state: ChipState<IdbError | Schema.SchemaError> = {
    readKey: read('key', KeyFile),
    writeKey: (privateKey) => write('key', { privateKey }),
    readPairing: read('pairing', PairingFile),
    writePairing: (pairing) => write('pairing', pairing),
    usedInvoices,
    spentOn,
    // Persist the invoice hash and the spend before the signature leaves the chip.
    recordSigned: (invoiceHash, amount, day) =>
      Effect.gen(function* () {
        const used = yield* usedInvoices
        yield* write('used', [...used, invoiceHash.toLowerCase()])
        const spent = yield* spentOn(day)
        yield* write('spent', { day, total: (spent + amount).toString() })
      }),
  }
  return state
})
