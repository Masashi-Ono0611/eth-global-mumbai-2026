import { format, type Locale } from '@ethmumbai/i18n'
import type { Attribute, ChildAttribute, Html, HtmlBuilder } from 'foldkit/html'
import { defineTaggedUnion } from 'foldkit/schema'
import { coinIcon } from './Icons.ts'
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

/**
 * The address as wallets print it: one unbroken checksummed string in a monospace face, so a hand-copied selection
 * pastes as a valid address and 0/O or 1/l cannot be confused. The start and the end are set apart, because those
 * are the characters a sender compares with what their wallet shows (it shortens to 0x689c…7C4D).
 */
const addressView = <M>(address: string, h: HtmlBuilder<M>): Html =>
  h.p(
    [h.Class(addressClassName)],
    [
      h.span([h.Class(addressEndClassName)], [address.slice(0, 6)]),
      address.slice(6, -4),
      h.span([h.Class(addressEndClassName)], [address.slice(-4)]),
    ],
  )

const qrFrameClassName = 'justify-self-center rounded-[26px] bg-surface p-4 shadow-[0_0_0_1px_var(--color-rule)]'
const qrClassName = 'block size-48'
const addressClassName = 'text-center font-mono text-[0.95rem] leading-relaxed break-all text-muted select-all'
const addressEndClassName = 'font-semibold text-ink'
const buttonsClassName = 'grid gap-2'
const onlyClassName = 'flex flex-wrap items-center justify-center gap-1.5 text-sm text-muted'
const badgeClassName = 'inline-flex items-center gap-1 rounded-full bg-paper px-2.5 py-1 font-semibold text-ink'
const buttonClassName =
  'min-h-12 cursor-pointer rounded-control bg-paper font-semibold transition-transform active:scale-[0.96]'

/** The QR, the address and "Copy address" with its outcome. */
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
    addressView(address, h),
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

/** What may be sent, as two badges ("Send only [USDC] on [Arc]"); screen readers hear the sentence. `attributes` lets a
 *  sheet use it as its description. */
export const onlyUsdcOnArc = <M>(
  locale: Locale,
  h: HtmlBuilder<M>,
  attributes: ReadonlyArray<Attribute<M> | ChildAttribute> = [],
): Html =>
  h.p(
    [...attributes, h.Class(onlyClassName)],
    [
      h.span([h.Class('sr-only')], [format(locale, 'receive.note', {})]),
      h.span([h.AriaHidden(true)], [format(locale, 'receive.sendOnly', {})]),
      h.span([h.Class(badgeClassName), h.AriaHidden(true)], [coinIcon(h), 'USDC']),
      h.span([h.AriaHidden(true)], [format(locale, 'receive.on', {})]),
      h.span(
        [h.Class(badgeClassName), h.AriaHidden(true)],
        [h.img([h.Src('/app/arc.svg'), h.Alt(''), h.Class('h-4 w-auto')]), 'Arc'],
      ),
    ],
  )
