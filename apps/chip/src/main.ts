import * as BunRuntime from '@effect/platform-bun/BunRuntime'
import * as BunServices from '@effect/platform-bun/BunServices'
import { Console, Effect, Layer, Option } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import { ChipEvent, ChipFailure, pair, type Report, serve } from './client.ts'
import { serveScans } from './scan.ts'
import { loadOrCreateKey, makeSigner } from './signer.ts'
import { makeState } from './state.ts'

// The mock chip (spec §8): `bun apps/chip/src/main.ts --server <URL> [--pair CODE] [--state DIR] [--local-port N]`.
// One log line per event; never the key, the chip token or a signature. `--local-port` adds the scan listener on
// 127.0.0.1 (scan.ts).

const usage = 'usage: bun apps/chip/src/main.ts --server <URL> [--pair CODE] [--state DIR] [--local-port N]'

const parseArgs = (argv: ReadonlyArray<string>, home: string) => {
  const value = (flag: string) => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : undefined
  }
  const server = value('--server')
  const localPort = value('--local-port')
  if (server === undefined) return undefined
  if (localPort !== undefined && !/^[1-9][0-9]{0,4}$/.test(localPort)) return undefined
  return {
    origin: new URL(server).origin,
    pairingCode: value('--pair'),
    stateDir: value('--state') ?? `${home}/.vitaquack-chip`,
    localPort: localPort === undefined ? undefined : Number(localPort),
  }
}

const log = (line: string) => Console.log(line)

/** One log line per event, as the CLI has always printed them (the native mock-chip tests read these). */
const report: Report = ChipEvent.$match({
  LeaseOk: () => log('lease ok'),
  LeaseExpired: () => log('STOP motors (lease expired)'),
  Signed: ({ invoiceId }) => log(`signed ${invoiceId}`),
  Refused: ({ invoiceId, code, detail }) => log(`refused ${invoiceId} ${code}: ${detail}`),
  Payment: ({ status, txHash, reason }) =>
    log(`payment ${status}${txHash === undefined ? '' : ` ${txHash}`}${reason === undefined ? '' : `: ${reason}`}`),
  ResponseRejected: ({ requestId, status }) => log(`response rejected (${status}) for ${requestId}`),
  ResponseFailed: ({ requestId, message }) => log(`response for ${requestId} failed: ${message}`),
  PollFailed: ({ message }) => log(message),
})

const main = Effect.fnUntraced(function* (argv: ReadonlyArray<string>, home: string) {
  const args = parseArgs(argv, home)
  if (args === undefined) return yield* new ChipFailure({ message: usage })
  const state = yield* makeState(args.stateDir)
  const key = yield* loadOrCreateKey(state)
  const signer = makeSigner(key.privateKey)
  yield* log(`chip ${signer.address}${key.created ? ' (new key)' : ''}`)
  const pairing =
    args.pairingCode === undefined
      ? Option.getOrUndefined(yield* state.readPairing)
      : yield* pair(args.origin, args.pairingCode, signer)
  if (pairing === undefined) return yield* new ChipFailure({ message: `not paired: ${usage}` })
  if (args.pairingCode !== undefined) {
    yield* state.writePairing(pairing)
    yield* log(`paired ${pairing.robotId}`)
  }
  if (pairing.server !== args.origin)
    return yield* new ChipFailure({ message: `paired with ${pairing.server}, not ${args.origin}` })
  if (args.localPort !== undefined) {
    yield* Effect.forkChild(serveScans(args.localPort, pairing, signer))
    yield* log(`scan listener on http://127.0.0.1:${args.localPort}/scan`)
  }
  return yield* serve(pairing, signer, state, report)
})

main(process.argv.slice(2), process.env.HOME ?? '.').pipe(
  Effect.catchTag('ChipFailure', (failure) =>
    Console.error(failure.message).pipe(Effect.andThen(Effect.fail(failure))),
  ),
  // No keep-alive: phone hotspots and proxies drop idle sockets, and a pooled socket reused after a 25 s hold resets.
  Effect.provide(
    Layer.mergeAll(
      BunServices.layer,
      FetchHttpClient.layer,
      Layer.succeed(FetchHttpClient.RequestInit, { keepalive: false }),
    ),
  ),
  BunRuntime.runMain,
)
