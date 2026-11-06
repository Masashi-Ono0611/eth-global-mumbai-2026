import { Bytes32, UintString } from '@ethmumbai/protocol/Hex'
import { Effect, FileSystem, Option, Schema } from 'effect'

// The chip's state directory (spec §8): key.json (mode 600, generated once), pairing.json, used-invoices.json and
// spent.json. The Radxa runs the same code with the same files.
export const KeyFile = Schema.Struct({ privateKey: Bytes32 })
export const PairingFile = Schema.Struct({ server: Schema.String, robotId: Schema.String, chipToken: Schema.String })
export type PairingFile = typeof PairingFile.Type
const UsedFile = Schema.Array(Bytes32)
const SpentFile = Schema.Struct({ day: Schema.Finite, total: UintString })

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

  const readKey = read('key.json', KeyFile)
  const writeKey = (privateKey: string) => write('key.json', { privateKey })
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

  return { readKey, writeKey, readPairing, writePairing, usedInvoices, spentOn, recordSigned }
})

export type ChipState = Effect.Success<ReturnType<typeof makeState>>
