import { format, type Locale } from '@ethmumbai/i18n'
import { Dialog } from '@foldkit/ui'
import { clsx } from 'clsx'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { terminalStates, worldAuthorizeUrl } from '../api/Robot.ts'
import { type EpisodeActivity, leftToday, type RobotView, usdc } from '../api/Wallet.ts'
import { duck } from '../Duck.ts'
import { qrDataUri } from '../Qr.ts'
import { robotConsoleRouter, robotsRouter } from '../route.ts'
import { sheetTitleClassName, sheetView } from '../Sheet.ts'
import { failedView, loadingView, signedOutView } from './Shared.ts'
import { Copy, Decline, type Home, Message, type Model, type NeedsYou, WalletState } from './Wallet.ts'

// STYLES

const pageClassName = 'grid gap-0 pb-6'
const balanceClassName = 'grid min-w-0 gap-0.5 px-2 pt-3'
const amountClassName =
  'font-display text-[clamp(2.75rem,16vw,4rem)] leading-[0.95] font-extrabold tracking-[-0.02em] wrap-anywhere'
const amountUnitClassName = 'ml-1.5 text-[1.4rem] font-bold tracking-normal'
const spentClassName = 'text-muted'
const pillRowClassName = 'flex flex-wrap gap-1.5 px-1 pt-4 pb-1'
const pillClassName =
  'inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-full bg-surface pr-3.5 pl-3 font-semibold no-underline shadow-[0_1px_2px_rgb(31_45_54/0.06)] transition-transform active:scale-[0.96]'
const pillDisabledClassName =
  'inline-flex min-h-11 cursor-not-allowed items-center gap-1 rounded-full bg-surface/60 pr-2.5 pl-3 font-semibold text-muted'
const soonClassName = 'rounded-md bg-paper px-1.5 text-xs font-semibold text-muted'
const sectionTitleClassName = 'px-2 pt-6 pb-2.5 font-display text-xl leading-tight font-bold'
const askCardClassName = 'mx-0.5 grid gap-2.5 rounded-[24px_24px_24px_8px] bg-duck px-4 pt-3.5 pb-4'
const whoClassName = 'flex items-center gap-2 text-sm text-duck-deep'
const whoNameClassName = 'font-semibold text-ink'
const askTextClassName = 'text-[1.06rem] leading-snug'
const quoteClassName = 'border-l-[2.5px] border-ink/25 pl-2.5 text-[0.94rem] text-ink/80'
const askButtonsClassName = 'grid grid-cols-[1fr_auto] gap-2'
const approveClassName =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-control bg-black px-3 font-semibold text-surface no-underline transition-transform active:scale-[0.96]'
const declineClassName =
  'min-h-12 cursor-pointer rounded-control bg-surface px-6 font-semibold transition-transform active:scale-[0.96] disabled:opacity-60'
const listClassName = 'mx-0.5 grid rounded-card bg-surface py-1 [&>li+li]:border-t [&>li+li]:border-rule'
const rowLinkClassName = 'grid min-h-[4.5rem] grid-cols-[52px_1fr_auto] items-center gap-3 px-3.5 py-2.5 no-underline'
const faceClassName = 'relative grid size-[52px] place-items-center rounded-full bg-ink'
const faceOfflineClassName = 'relative grid size-[52px] place-items-center rounded-full bg-rule'
const onlineDotClassName = 'absolute right-px bottom-px size-[13px] rounded-full border-[3px] border-surface bg-online'
const offlineDotClassName = 'absolute right-px bottom-px size-[13px] rounded-full border-[3px] border-surface bg-muted'
const rowNameClassName = 'block text-[1.06rem] leading-tight font-semibold'
const rowLineClassName = 'block truncate text-[0.94rem] text-muted'
const badgeClassName =
  'grid h-[22px] min-w-[22px] place-items-center rounded-full bg-duck px-1.5 text-[0.8rem] font-bold'
const addFaceClassName = 'grid size-[52px] place-items-center rounded-full bg-paper text-2xl text-ink'
const paymentRowClassName = 'flex justify-between gap-3 px-4 py-3 [&>span:first-child]:min-w-0'
const paymentSubClassName = 'block text-[0.92rem] text-muted'
const paymentAmountClassName = 'shrink-0 text-right font-semibold whitespace-nowrap'
const paidClassName = 'block text-[0.92rem] text-paid'
const emptyClassName = 'px-2 text-muted'
const qrFrameClassName = 'justify-self-center rounded-[26px] bg-surface p-4 shadow-[0_0_0_1px_var(--color-rule)]'
const qrClassName = 'block size-48'
const addressClassName = 'text-center text-[1.06rem] leading-relaxed font-semibold tracking-[0.04em] break-words'
const sheetButtonsClassName = 'grid gap-2'
const sheetButtonClassName =
  'min-h-12 cursor-pointer rounded-control bg-paper font-semibold transition-transform active:scale-[0.96]'
const noteClassName = 'text-center text-sm text-balance text-muted'

// VIEW

const itemName = (item: string) => item.slice(0, 1).toUpperCase() + item.slice(1)

const balanceView = (home: Home, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.Class(balanceClassName), h.AriaLabel(format(locale, 'home.balanceLabel', {}))],
    [
      home.wallet.balance === null
        ? h.p([h.Class('text-muted')], [format(locale, 'home.balanceUnknown', {})])
        : h.p([h.Class(amountClassName)], [home.wallet.balance.usdc, h.span([h.Class(amountUnitClassName)], ['USDC'])]),
      h.p(
        [h.Class(spentClassName)],
        [
          home.spentLastDay === '0'
            ? format(locale, 'home.spentNone', {})
            : format(locale, 'home.spent', { amount: usdc(home.spentLastDay) }),
        ],
      ),
    ],
  )

const pills = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.nav(
    [h.Class(pillRowClassName), h.AriaLabel(format(locale, 'home.actions', {}))],
    [
      h.button(
        [
          h.Type('button'),
          h.Class(pillDisabledClassName),
          h.Disabled(true),
          h.AriaLabel(format(locale, 'home.sendSoon', {})),
        ],
        [
          h.span([h.AriaHidden(true)], ['↗ ']),
          format(locale, 'home.send', {}),
          h.span([h.Class(soonClassName)], [format(locale, 'home.soon', {})]),
        ],
      ),
      h.button(
        [h.Type('button'), h.Class(pillClassName), h.OnClick(Message.ClickedReceive())],
        [h.span([h.AriaHidden(true)], ['↙ ']), format(locale, 'home.receive', {})],
      ),
      h.a(
        [h.Href(robotsRouter()), h.Class(pillClassName), h.AriaLabel(format(locale, 'home.addRobot', {}))],
        [h.span([h.AriaHidden(true)], ['+ ']), format(locale, 'home.robot', {})],
      ),
    ],
  )

const askCard = (model: Model, need: NeedsYou, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const declining = Decline.guards.Declining(model.decline) && model.decline.approvalId === need.approvalId
  const failed = Decline.guards.Failed(model.decline) && model.decline.approvalId === need.approvalId
  return h.keyed('article')(
    need.approvalId,
    [h.Class(askCardClassName)],
    [
      h.p([h.Class(whoClassName)], [h.span([h.Class(whoNameClassName)], [need.robotName])]),
      h.p(
        [h.Class(askTextClassName)],
        [
          need.amount === null
            ? format(locale, 'home.askNoAmount', { item: need.item })
            : format(locale, 'home.ask', { item: need.item, amount: usdc(need.amount) }),
        ],
      ),
      need.reason === null
        ? h.empty
        : h.p([h.Class(quoteClassName)], [format(locale, 'home.zeroGReason', { reason: need.reason })]),
      h.div(
        [h.Class(askButtonsClassName)],
        [
          h.a(
            [h.Href(worldAuthorizeUrl(need.approvalId)), h.Class(approveClassName)],
            [format(locale, 'home.approve', {})],
          ),
          h.button(
            [
              h.Type('button'),
              h.Class(declineClassName),
              h.Disabled(declining),
              h.OnClick(Message.ClickedDecline({ approvalId: need.approvalId })),
            ],
            [format(locale, declining ? 'home.declining' : 'home.decline', {})],
          ),
        ],
      ),
      failed && Decline.guards.Failed(model.decline)
        ? h.p(
            [h.Role('alert'), h.Class('text-error')],
            [format(locale, 'home.declineFailed', { message: model.decline.error })],
          )
        : h.empty,
    ],
  )
}

/** What the robot's latest errand says about it, while it is live or when it ended in a way worth a line. */
const errandLine = (episode: Home['episodes'][number], locale: Locale): string | null => {
  const item = episode.item
  if (episode.state === 'awaiting_approval') return format(locale, 'home.lineWaiting', {})
  if (!terminalStates.has(episode.state)) return format(locale, 'home.lineBusy', { item })
  if (episode.state === 'paid') return format(locale, 'home.linePaid', { item })
  if (episode.state === 'denied') return format(locale, 'home.lineDenied', { item })
  return null
}

/** The robot's last line, in its own words where the errand's state supports them. */
const robotLine = (robot: RobotView, home: Home, locale: Locale): string => {
  if (robot.status === 'unpaired')
    return robot.pairingCode === null
      ? format(locale, 'home.lineCodeExpired', {})
      : format(locale, 'home.linePairing', { code: robot.pairingCode })
  const latest = home.episodes.find((episode) => episode.robotId === robot.id)
  const fromErrand = latest === undefined ? null : errandLine(latest, locale)
  if (fromErrand !== null) return fromErrand
  if (!robot.lease.online) return format(locale, 'home.lineOffline', {})
  if (robot.grant === null || robot.grant.status !== 'active') return format(locale, 'home.lineNoAllowance', {})
  const left = leftToday(robot.grant)
  return left === null ? format(locale, 'home.lineReady', {}) : format(locale, 'home.lineLeft', { amount: usdc(left) })
}

const robotRow = (robot: RobotView, home: Home, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const waiting = home.needsYou.filter((need) => need.robotId === robot.id).length
  const href = robot.status === 'paired' ? robotConsoleRouter({ robotId: robot.id }) : robotsRouter()
  return h.keyed('li')(
    robot.id,
    [],
    [
      h.a(
        [h.Href(href), h.Class(rowLinkClassName)],
        [
          h.span(
            [h.Class(robot.lease.online ? faceClassName : faceOfflineClassName)],
            [
              duck('size-[38px]', !robot.lease.online, h),
              h.span([
                h.Class(robot.lease.online ? onlineDotClassName : offlineDotClassName),
                h.AriaLabel(format(locale, robot.lease.online ? 'home.connected' : 'home.offline', {})),
                h.Role('img'),
              ]),
            ],
          ),
          h.span(
            [h.Class('min-w-0')],
            [
              h.span([h.Class(rowNameClassName)], [robot.name]),
              h.span([h.Class(rowLineClassName)], [robotLine(robot, home, locale)]),
            ],
          ),
          waiting === 0
            ? h.span([])
            : h.span(
                [
                  h.Class(badgeClassName),
                  h.Role('img'),
                  h.AriaLabel(format(locale, 'home.waitingCount', { count: waiting })),
                ],
                [String(waiting)],
              ),
        ],
      ),
    ],
  )
}

const addRobotRow = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.li(
    [],
    [
      h.a(
        [h.Href(robotsRouter()), h.Class(rowLinkClassName)],
        [
          h.span([h.Class(addFaceClassName), h.AriaHidden(true)], ['+']),
          h.span(
            [],
            [
              h.span([h.Class(rowNameClassName)], [format(locale, 'home.addRobot', {})]),
              h.span([h.Class(rowLineClassName)], [format(locale, 'home.addRobotHint', {})]),
            ],
          ),
          h.span([]),
        ],
      ),
    ],
  )

const paymentRow = (episode: EpisodeActivity, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const paid = episode.state === 'paid'
  const live = !terminalStates.has(episode.state)
  const amount = episode.amount === null ? '—' : usdc(episode.amount)
  return h.keyed('li')(
    episode.id,
    [h.Class(paymentRowClassName)],
    [
      h.span(
        [],
        [
          h.span([h.Class('font-semibold')], [itemName(episode.item)]),
          h.span(
            [h.Class(paymentSubClassName)],
            [format(locale, 'home.paymentBy', { robot: episode.robotName, state: episode.state })],
          ),
        ],
      ),
      h.span(
        [h.Class(paymentAmountClassName)],
        [
          paid ? h.span([], [`−${amount}`]) : live ? h.span([], [amount]) : h.s([h.Class('text-muted')], [amount]),
          h.span(
            [h.Class(clsx(paid ? paidClassName : paymentSubClassName))],
            [format(locale, paid ? 'home.paid' : live ? 'home.pending' : 'home.notPaid', {})],
          ),
        ],
      ),
    ],
  )
}

/** Four-character groups, so an address can be read aloud and checked by eye. */
const grouped = (address: string) => address.slice(0, 6) + ' ' + (address.slice(6).match(/.{1,4}/g) ?? []).join(' ')

const receiveSheet = (model: Model, home: Home, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const address = home.wallet.account.smartAccount
  return h.submodel({
    slotId: model.receiveSheet.id,
    model: model.receiveSheet,
    view: Dialog.view,
    viewInputs: {
      hasDescription: true,
      toView: (render: Dialog.RenderInfo) =>
        sheetView(
          render,
          [
            h.h2([...render.title, h.Class(sheetTitleClassName)], [format(locale, 'receive.title', {})]),
            h.div(
              [h.Class(qrFrameClassName)],
              [h.img([h.Src(qrDataUri(address)), h.Alt(format(locale, 'receive.qrAlt', {})), h.Class(qrClassName)])],
            ),
            h.p([h.Class(addressClassName)], [grouped(address)]),
            h.div(
              [h.Class(sheetButtonsClassName)],
              [
                h.button(
                  [h.Type('button'), h.Class(sheetButtonClassName), h.OnClick(Message.ClickedCopyAddress({ address }))],
                  [format(locale, 'receive.copy', {})],
                ),
                Copy.match(model.copy, {
                  Idle: () => h.empty,
                  Copied: () =>
                    h.p([h.Role('status'), h.Class('text-center text-paid')], [format(locale, 'receive.copied', {})]),
                  Failed: () =>
                    h.p(
                      [h.Role('alert'), h.Class('text-center text-error')],
                      [format(locale, 'receive.copyFailed', {})],
                    ),
                }),
              ],
            ),
            h.p([...render.description, h.Class(noteClassName)], [format(locale, 'receive.note', {})]),
          ],
          format(locale, 'profile.close', {}),
          h,
        ),
    },
    toParentMessage: (message) => Message.GotReceiveSheetMessage({ message }),
  })
}

const loadedView = (model: Model, home: Home, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class(pageClassName)],
    [
      balanceView(home, locale, h),
      pills(locale, h),
      home.needsYou.length === 0
        ? h.empty
        : h.section(
            [h.AriaLabelledBy('needs-you')],
            [
              h.h2([h.Id('needs-you'), h.Class(sectionTitleClassName)], [format(locale, 'home.needsYou', {})]),
              h.div(
                [h.Class('grid gap-2')],
                home.needsYou.map((need) => askCard(model, need, locale, h)),
              ),
            ],
          ),
      h.section(
        [h.AriaLabelledBy('robots')],
        [
          h.h2([h.Id('robots'), h.Class(sectionTitleClassName)], [format(locale, 'home.robots', {})]),
          h.ul(
            [h.Class(listClassName)],
            [...home.robots.map((robot) => robotRow(robot, home, locale, h)), addRobotRow(locale, h)],
          ),
        ],
      ),
      h.section(
        [h.AriaLabelledBy('payments')],
        [
          h.h2([h.Id('payments'), h.Class(sectionTitleClassName)], [format(locale, 'home.payments', {})]),
          home.activity.episodes.length === 0
            ? h.p([h.Class(emptyClassName)], [format(locale, 'home.noPayments', {})])
            : h.ul(
                [h.Class(listClassName)],
                home.activity.episodes.map((episode) => paymentRow(episode, locale, h)),
              ),
        ],
      ),
      receiveSheet(model, home, locale, h),
    ],
  )

/** `/wallet`: the owner's home (DESIGN.md "Layout"): balance, Send/Receive/Robot, what needs them, robots, payments. */
export const walletView = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) =>
  h.main(
    [h.Id('main')],
    [
      h.h1([h.Class('sr-only')], [format(locale, 'wallet.title', {})]),
      WalletState.match(model.state, {
        Loading: () => loadingView(locale, h),
        SignedOut: () => signedOutView(locale, h),
        Loaded: ({ home }) => loadedView(model, home, locale, h),
        Failed: ({ error }) => failedView(error, Message.ClickedReload(), locale, h),
      }),
    ],
  ),
)
