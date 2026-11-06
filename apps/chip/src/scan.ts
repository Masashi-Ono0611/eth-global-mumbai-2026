import * as BunHttpServer from '@effect/platform-bun/BunHttpServer'
import { Id } from '@ethmumbai/protocol/Base32'
import { UnixMs } from '@ethmumbai/protocol/Hex'
import { scanMessage } from '@ethmumbai/protocol/Scan'
import { Clock, Console, Effect, Layer, Option, Result, Schema } from 'effect'
import * as Base64 from 'effect/encoding/Base64'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import { sha256 } from 'viem'
import type { Signer } from './signer.ts'
import type { PairingFile } from './state.ts'

// The chip's local scan listener (`--local-port N`, 127.0.0.1 only): the camera process on the same board posts the QR
// crop it read; the chip hashes it, signs the scan with its key and forwards it to the Worker's
// `POST /api/chips/:robotId/scans`, answering with the Worker's status and JSON. Logs never carry the key, the chip
// token, the signature or the image.

/** What the camera process posts: the invoice id the QR carries and the JPEG crop of that QR. */
const LocalScan = Schema.Struct({
  invoiceId: Id,
  jpegBase64: Schema.String,
  /** Unix ms when the crop was taken; the chip's clock when absent. */
  capturedAt: Schema.optionalKey(UnixMs),
})

/** The chip signs no more than a QR crop (spec rule 4, the Worker's limit too), checked before the key is touched. */
const MAX_SCAN_BYTES = 64 * 1024

const reply = (status: number, body: unknown) => HttpServerResponse.jsonUnsafe(body, { status })

/** The crop's bytes if they are base64 of a JPEG (SOI marker) of at most 64 KB; otherwise why not. */
const cropOf = (jpegBase64: string) =>
  Option.match(Result.getSuccess(Base64.decode(jpegBase64)), {
    onNone: () => Result.fail('jpegBase64 is not base64'),
    onSome: (bytes) =>
      bytes.length > MAX_SCAN_BYTES
        ? Result.fail('crop is larger than 64 KB')
        : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
          ? Result.succeed(bytes)
          : Result.fail('crop is not a JPEG'),
  })

const scan = (pairing: PairingFile, signer: Signer) =>
  Effect.gen(function* () {
    const input = yield* HttpServerRequest.schemaBodyJson(LocalScan).pipe(Effect.option)
    if (Option.isNone(input)) return reply(400, { error: 'expected {"invoiceId", "jpegBase64", "capturedAt"?}' })
    const crop = cropOf(input.value.jpegBase64)
    if (Result.isFailure(crop)) return reply(400, { error: crop.failure })
    const frame = crop.success
    const digest = sha256(frame)
    const capturedAt = input.value.capturedAt ?? (yield* Clock.currentTimeMillis)
    const { invoiceId } = input.value
    const sig = yield* signer.signScan(scanMessage(invoiceId, digest, capturedAt, pairing.robotId))
    const body = {
      invoiceId,
      capturedAt,
      frame: { mime: 'image/jpeg', sha256: digest, bytes: frame.length, b64: Base64.encode(frame) },
      sig,
    }
    const response = yield* HttpClient.execute(
      HttpClientRequest.post(`${pairing.server}/api/chips/${pairing.robotId}/scans`).pipe(
        HttpClientRequest.bodyJsonUnsafe(body),
        HttpClientRequest.bearerToken(pairing.chipToken),
      ),
    ).pipe(Effect.timeout('60 seconds'))
    const answer: unknown = yield* response.json.pipe(
      Effect.orElseSucceed(() => ({ error: 'no JSON from the Worker' })),
    )
    yield* Console.log(`scan ${invoiceId} ${digest.slice(0, 10)}… → ${response.status}`)
    return reply(response.status, answer)
  }).pipe(
    Effect.catch((error) =>
      Console.log(`scan failed: ${String(error)}`).pipe(
        Effect.as(reply(502, { error: 'the Worker did not answer the scan' })),
      ),
    ),
  )

/** Serve `POST /scan` on 127.0.0.1:`port` until the chip stops; never on another interface. */
export const serveScans = (port: number, pairing: PairingFile, signer: Signer) =>
  HttpRouter.serve(HttpRouter.add('POST', '/scan', scan(pairing, signer)), { disableLogger: true }).pipe(
    Layer.provide(BunHttpServer.layer({ hostname: '127.0.0.1', port })),
    Layer.launch,
  )
