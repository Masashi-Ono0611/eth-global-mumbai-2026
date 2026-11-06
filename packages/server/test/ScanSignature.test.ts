import { EcdsaSignature } from '@ethmumbai/protocol/Hex'
import { scanMessage } from '@ethmumbai/protocol/Scan'
import { Schema } from 'effect'
import { getAddress, recoverMessageAddress } from 'viem'
import { describe, expect, test } from 'vitest'
import golden from '@ethmumbai/protocol/golden.json' with { type: 'json' }

// The scan golden vector checked the way the Worker checks a scan (as Pairing.ts checks a pairing): EIP-191 recovery
// of the chip's signature over `scanMessage(...)`, compared with the paired chip address.
const { scan } = golden
const signature = Schema.decodeUnknownSync(EcdsaSignature)(scan.sig)
const recover = (invoiceId: string, sha256: string, capturedAt: number, robotId: string) =>
  recoverMessageAddress({ message: scanMessage(invoiceId, sha256, capturedAt, robotId), signature })
const tampered = (digit: string) => (digit === '0' ? '1' : '0')

describe('scan signature', () => {
  test('the golden signature over the rebuilt message recovers the golden chip address', async () => {
    const signer = await recover(scan.invoiceId, scan.frame.sha256, scan.capturedAt, scan.robotId)
    expect(signer).toBe(getAddress(scan.signer))
  })

  test('changing any signed field recovers a different address', async () => {
    const otherSha = `${scan.frame.sha256.slice(0, -1)}${tampered(scan.frame.sha256.slice(-1))}`
    const recovered = await Promise.all([
      recover(scan.robotId, scan.frame.sha256, scan.capturedAt, scan.robotId),
      recover(scan.invoiceId, otherSha, scan.capturedAt, scan.robotId),
      recover(scan.invoiceId, scan.frame.sha256, scan.capturedAt + 1, scan.robotId),
      recover(scan.invoiceId, scan.frame.sha256, scan.capturedAt, scan.invoiceId),
    ])
    for (const address of recovered) expect(address).not.toBe(getAddress(scan.signer))
  })
})
