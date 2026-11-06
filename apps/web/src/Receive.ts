import { format, type Locale } from '@ethmumbai/i18n'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineTaggedUnion } from 'foldkit/schema'
import { qrDataUri } from './Qr.ts'

// Funding the wallet: the QR, the address and "Copy address", shown in the wallet's Receive sheet and in onboarding's
// "Add money" step. USDC is Arc's native token (18-decimal native balance, 6-decimal ERC-20 view of the same money).

/** Arc mainnet's chain id. */
const ARC_CHAIN_ID = 5042

/** Whether "Copy address" worked, shown under the button. */
export const Copy = defineTaggedUnion({ Idle: {}, Copied: {}, Failed: {} })
export type Copy = typeof Copy.Type

/**
 * The QR's text: an EIP-681 payment request for the wallet on Arc (`ethereum:<address>@5042`), so a wallet app that
 * scans it opens a send to this address on the right network. The address is printed and copyable beside it.
 */
const paymentRequest = (address: string) => `ethereum:${address}@${ARC_CHAIN_ID}`

/** Four-character groups, so an address can be read aloud and checked by eye. */
const grouped = (address: string) => address.slice(0, 6) + ' ' + (address.slice(6).match(/.{1,4}/g) ?? []).join(' ')

const qrFrameClassName = 'justify-self-center rounded-[26px] bg-surface p-4 shadow-[0_0_0_1px_var(--color-rule)]'
const qrClassName = 'block size-48'
const addressClassName = 'text-center text-[1.06rem] leading-relaxed font-semibold tracking-[0.04em] break-words'
const buttonsClassName = 'grid gap-2'
const buttonClassName =
  'min-h-12 cursor-pointer rounded-control bg-paper font-semibold transition-transform active:scale-[0.96]'

/** The QR, the grouped address and "Copy address" with its outcome. */
export const receiveBody = <M>(input: {
  readonly address: string
  readonly copy: Copy
  readonly onCopy: M
  readonly locale: Locale
  readonly h: HtmlBuilder<M>
}): ReadonlyArray<Html> => {
  const { address, copy, onCopy, locale, h } = input
  return [
    h.div(
      [h.Class(qrFrameClassName)],
      [
        h.img([
          h.Src(qrDataUri(paymentRequest(address))),
          h.Alt(format(locale, 'receive.qrAlt', {})),
          h.Class(qrClassName),
        ]),
      ],
    ),
    h.p([h.Class(addressClassName)], [grouped(address)]),
    h.div(
      [h.Class(buttonsClassName)],
      [
        h.button([h.Type('button'), h.Class(buttonClassName), h.OnClick(onCopy)], [format(locale, 'receive.copy', {})]),
        Copy.match(copy, {
          Idle: () => h.empty,
          Copied: () =>
            h.p([h.Role('status'), h.Class('text-center text-paid')], [format(locale, 'receive.copied', {})]),
          Failed: () =>
            h.p([h.Role('alert'), h.Class('text-center text-error')], [format(locale, 'receive.copyFailed', {})]),
        }),
      ],
    ),
  ]
}
