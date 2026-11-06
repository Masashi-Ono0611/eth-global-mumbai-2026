import { format, type Locale } from '@ethmumbai/i18n'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { usdc } from '../api/Wallet.ts'
import { workingDots } from '../Busy.ts'
import { receiveBody } from '../Receive.ts'
import { robotsRouter, walletRouter } from '../route.ts'
import * as Telegram from '../Telegram.ts'
import { failedView, loadingView, signedOutView } from './Shared.ts'
import { Funds, Message, type Model, Step } from './Welcome.ts'

// STYLES

const pageClassName = 'grid gap-4 px-1 pt-3 pb-8 transition-opacity duration-150 starting:opacity-0'
const headerClassName = 'flex items-center justify-between gap-3'
const progressClassName = 'text-sm font-semibold text-muted'
const laterClassName = 'text-sm font-semibold text-ink underline underline-offset-2'
const titleClassName = 'font-display text-[1.9rem] leading-tight font-extrabold text-balance'
const leadClassName = 'text-muted text-pretty'
const cardClassName = 'grid gap-3 rounded-card bg-surface p-4'
const actionClassName =
  'flex min-h-12 cursor-pointer items-center justify-center rounded-control bg-ink px-5 font-semibold text-surface no-underline transition-transform active:scale-[0.96]'
const quietClassName =
  'min-h-11 cursor-pointer justify-self-center rounded-control px-4 font-semibold text-ink underline underline-offset-2 transition-transform active:scale-[0.96]'
const statusClassName = 'text-center text-sm text-muted'
const noteClassName = 'text-center text-sm text-balance text-muted'

type ViewInputs = { readonly locale: Locale }

const stepNumber = (step: Step) => Step.match(step, { Telegram: () => 1, Fund: () => 2, Robot: () => 3 })

const header = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class(headerClassName)],
    [
      h.p([h.Class(progressClassName)], [format(locale, 'welcome.progress', { step: stepNumber(model.step) })]),
      h.a([h.Href(walletRouter()), h.Class(laterClassName)], [format(locale, 'welcome.toWallet', {})]),
    ],
  )

const intro = (title: string, lead: string, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  h.h1([h.Class(titleClassName)], [title]),
  h.p([h.Class(leadClassName)], [lead]),
]

const quiet = (label: string, onClick: Message, h: HtmlBuilder<Message>): Html =>
  h.button([h.Type('button'), h.Class(quietClassName), h.OnClick(onClick)], [label])

const telegramStep = (model: Model, locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  ...intro(format(locale, 'welcome.telegramTitle', {}), format(locale, 'welcome.telegramLead', {}), h),
  h.submodel({
    slotId: 'welcome-telegram',
    model: model.telegram,
    view: Telegram.view,
    viewInputs: { locale },
    toParentMessage: (message) => Message.GotTelegramMessage({ message }),
  }),
  quiet(format(locale, 'welcome.skip', {}), Message.ClickedSkipTelegram(), h),
]

const fundStep = (model: Model, locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  ...intro(format(locale, 'welcome.fundTitle', {}), format(locale, 'welcome.fundLead', {}), h),
  Funds.match(model.funds, {
    Loading: () => loadingView(locale, h),
    SignedOut: () => signedOutView(locale, h),
    Failed: ({ error }) => failedView(error, Message.ClickedRetry(), locale, h),
    Loaded: ({ address }) =>
      h.section(
        [h.Class(cardClassName), h.AriaLabel(format(locale, 'receive.title', {}))],
        [
          ...receiveBody({ address, copy: model.copy, onCopy: Message.ClickedCopyAddress({ address }), locale, h }),
          h.p(
            [h.Role('status'), h.Class(statusClassName)],
            [workingDots(h), format(locale, 'welcome.fundWaiting', {})],
          ),
          h.p([h.Class(noteClassName)], [format(locale, 'receive.note', {})]),
        ],
      ),
  }),
  quiet(format(locale, 'welcome.later', {}), Message.ClickedSkipFunding(), h),
]

const robotStep = (model: Model, locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> => {
  // Only money in is news here (green): an empty wallet says nothing on this step.
  const balance =
    Funds.guards.Loaded(model.funds) && model.funds.balanceUnits !== null && BigInt(model.funds.balanceUnits) > 0n
      ? usdc(model.funds.balanceUnits)
      : null
  return [
    ...intro(format(locale, 'welcome.robotTitle', {}), format(locale, 'welcome.robotLead', {}), h),
    balance === null
      ? h.empty
      : h.p([h.Role('status'), h.Class('font-semibold text-paid')], [format(locale, 'welcome.funded', { balance })]),
    h.a([h.Href(robotsRouter()), h.Class(actionClassName)], [format(locale, 'welcome.addRobot', {})]),
  ]
}

export const welcomeView = Submodel.defineView<Model, Message, ViewInputs>((model, { locale }, h) =>
  h.div(
    [h.Class(pageClassName)],
    [
      header(model, locale, h),
      ...Step.match(model.step, {
        Telegram: () => telegramStep(model, locale, h),
        Fund: () => fundStep(model, locale, h),
        Robot: () => robotStep(model, locale, h),
      }),
    ],
  ),
)
