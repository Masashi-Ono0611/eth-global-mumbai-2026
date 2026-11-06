import { Bytes32, type Hex, UintString } from '@ethmumbai/protocol/Hex'
import { Effect, FileSystem, Option, Schema } from 'effect'

// The chip's state (spec §8): its key, its pairing, the invoices it signed and today's spend. `ChipState` is the
// platform-agnostic seam client.ts runs on; `makeState` is the Bun/Radxa implementation over a directory of key.json
// (mode 600, generated once), pairing.json, used-invoices.json and spent.json. The browser sim chip implements the
// same interface over IndexedDB (apps/sim/src/chip/idbState.ts).
export const KeyFile = Schema.Struct({ privateKey: Bytes32 })
export const PairingFile = Schema.Struct({ server: Schema.String, robotId: Schema.String, chipToken: Schema.String })
export type PairingFile = typeof PairingFile.Type
export const UsedFile = Schema.Array(Bytes32)
export const SpentFile = Schema.Struct({ day: Schema.Finite, total: UintString })

/** Where a chip keeps its key and its spending memory; `E` is the storage's own failure. */
export interface ChipState<E = never> {
  readonly readKey: Effect.Effect<Option.Option<{ readonly privateKey: Hex }>, E>
  readonly writeKey: (privateKey: Hex) => Effect.Effect<void, E>
  readonly readPairing: Effect.Effect<Option.Option<PairingFile>, E>
  readonly writePairing: (pairing: PairingFile) => Effect.Effect<void, E>
  /** Lowercase invoice hashes this chip has signed. */
  readonly usedInvoices: Effect.Effect<ReadonlySet<string>, E>
  /** USDC base units signed on `day` ({@link dayOf}). */
  readonly spentOn: (day: number) => Effect.Effect<bigint, E>
  /** Persist the invoice hash and the spend before the signature leaves the chip. */
  readonly recordSigned: (invoiceHash: string, amount: bigint, day: number) => Effect.Effect<void, E>
}

/** The chip's spending day: UTC days since the epoch (the on-chain period is 86 400 s too). */
export const dayOf = (nowSeconds: number) => Math.floor(nowSeconds / 86_400)

export const makeState = Effect.fnUntraced(function* (directory: string) {
  // @effect-diagnostics-next-line unstableApiUsage:off -- The chip's state files need the Bun FileSystem service; no stable Effect file API exists.
  const fs = yield* FileSystem.FileSystem
  yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 })
  const file = (name: string) => `${directory.replace(/\/+$/, '')}/${name}`

  const read = <A>(name: string, schema: Schema.ConstraintDecoder<A>) =>
    fs
      .exists(file(name))
      .pipe(
        Effect.flatMap((exists) =>
          exists
            ? fs
                .readFileString(file(name))
                .pipe(
                  Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))),
                  Effect.flatMap(Schema.decodeUnknownEffect(schema)),
                  Effect.asSome,
                )
            : Effect.succeed(Option.none<A>()),
        ),
      )

  /** Private files only: created 600 and re-chmodded in case an older copy was wider. */
  const write = (name: string, value: unknown) =>
    fs
      .writeFileString(file(name), `${JSON.stringify(value)}\n`, { mode: 0o600 })
      .pipe(Effect.andThen(fs.chmod(file(name), 0o600)))

  /** An existing key file is tightened to 600 too, whoever created it. */
  const readKey = read('key.json', KeyFile).pipe(
    Effect.tap((key) => (Option.isSome(key) ? fs.chmod(file('key.json'), 0o600) : Effect.void)),
  )
  const writeKey = (privateKey: Hex) => write('key.json', { privateKey })
  const readPairing = read('pairing.json', PairingFile)
  const writePairing = (pairing: PairingFile) => write('pairing.json', pairing)
  const usedInvoices = read('used-invoices.json', UsedFile).pipe(
    Effect.map((used) => new Set(Option.getOrElse(used, () => []).map((hash) => hash.toLowerCase()))),
  )
  const spentOn = (day: number) =>
    read('spent.json', SpentFile).pipe(
      Effect.map((spent) =>
        Option.match(spent, { onNone: () => 0n, onSome: (value) => (value.day === day ? BigInt(value.total) : 0n) }),
      ),
    )

  /** Persist the invoice hash and the spend before the signature leaves the chip. */
  const recordSigned = (invoiceHash: string, amount: bigint, day: number) =>
    Effect.gen(function* () {
      const used = yield* usedInvoices
      yield* write('used-invoices.json', [...used, invoiceHash.toLowerCase()])
      const spent = yield* spentOn(day)
      yield* write('spent.json', { day, total: (spent + amount).toString() })
    })

  /** Failures: the filesystem's and a malformed file's. */
  type FileStateError = Effect.Error<ReturnType<typeof fs.readFileString>> | Schema.SchemaError
  const state: ChipState<FileStateError> = {
    readKey,
    writeKey,
    readPairing,
    writePairing,
    usedInvoices,
    spentOn,
    recordSigned,
  }
  return state
})
