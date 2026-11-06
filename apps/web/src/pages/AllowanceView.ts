import { format, type Locale } from '@ethmumbai/i18n'
import { Option } from 'effect'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { clockTime } from '../api/Episodes.ts'
import { ActionFailure } from '../api/OwnerAction.ts'
import { usdc } from '../api/Wallet.ts'
import { DAILY_PRESETS, HOUR_PRESETS, Message, type Model, PER_PAYMENT_PRESETS, Step, Stop } from './Allowance.ts'

// STYLES

const formClassName = 'grid gap-3.5'
const fieldsetClassName = 'grid gap-1.5'
const legendClassName = 'mb-1.5 text-sm font-semibold text-muted'
const segmentsClassName = 'grid auto-cols-fr grid-flow-col gap-1 rounded-2xl bg-paper p-1'
const segmentClassName =
  'grid min-h-11 cursor-pointer place-items-center rounded-xl font-semibold text-muted has-[:checked]:bg-surface has-[:checked]:text-ink has-[:checked]:shadow-[0_1px_3px_rgb(0_0_0/0.1)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus'
const payeeClassName = 'flex min-h-11 items-center gap-2 rounded-2xl bg-paper px-3.5 font-semibold'
const summaryClassName = 'rounded-2xl bg-paper px-4 py-3 text-[0.96rem] shadow-[inset_3px_0_0_var(--color-duck)]'
const primaryClassName =
  'inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-control bg-ink px-4 font-semibold text-surface transition-transform active:scale-[0.96] disabled:opacity-60'
const secondaryClassName =
  'min-h-12 cursor-pointer rounded-control bg-paper px-4 font-semibold transition-transform active:scale-[0.96]'
const stopClassName =
  'inline-flex min-h-12 cursor-pointer items-center justify-center rounded-control bg-error-soft px-4 font-semibold text-error transition-transform active:scale-[0.96] disabled:opacity-60'
const rulesClassName = 'grid gap-1.5 [&_li]:flex [&_li]:gap-2'
const leftClassName = 'font-display text-4xl leading-none font-extrabold'
const noteClassName = 'text-center text-sm text-balance text-muted'

// VIEW

/** The grant the robot holds now, as the Worker mirrors it (Arc is the authority). */
type ActiveGrant = Readonly<{
  id: string
  status: string
  dailyCap: string
  perPaymentCap: string
  expiresAt: number
}>

export type ViewInputs = Readonly<{
  locale: Locale
  timeZone: string
  robotName: string
  payeeName: string
  grant: ActiveGrant | null
}>

const failureText = (failure: ActionFailure, locale: Locale) =>
  ActionFailure.match(failure, {
    Passkey: () => format(locale, 'auth.passkeyFailed', {}),
    Server: ({ error }) => format(locale, 'common.errorDetail', { message: error }),
  })

const segments = (
  name: string,
  legend: string,
  options: ReadonlyArray<string>,
  selected: string,
  label: (value: string) => string,
  toMessage: (value: string) => Message,
  disabled: boolean,
  h: HtmlBuilder<Message>,
): Html =>
  h.fieldset(
    [h.Class(fieldsetClassName), h.Disabled(disabled)],
    [
      h.legend([h.Class(legendClassName)], [legend]),
      h.div(
        [h.Class(segmentsClassName)],
        options.map((value) =>
          h.keyed('label')(
            value,
            [h.Class(segmentClassName), h.For(`${name}-${value}`)],
            [
              h.input([
                h.Id(`${name}-${value}`),
                h.Type('radio'),
                h.Name(name),
                h.Value(value),
                h.Checked(value === selected),
                h.Class('sr-only'),
                h.OnClick(toMessage(value)),
              ]),
              label(value),
            ],
          ),
        ),
      ),
    ],
  )

const hoursLabel = (hours: string, locale: Locale) => format(locale, 'allowance.hours', { hours: Number(hours) })

const form = (model: Model, inputs: ViewInputs, h: HtmlBuilder<Message>): Html => {
  const { locale } = inputs
  const signing = Step.guards.Signing(model.step)
  return h.div(
    [h.Class(formClassName), h.AriaBusy(signing)],
    [
      segments(
        'daily',
        format(locale, 'allowance.perDay', {}),
        DAILY_PRESETS,
        model.daily,
        (value) => value,
        (value) => Message.SelectedDaily({ value }),
        signing,
        h,
      ),
      segments(
        'per-payment',
        format(locale, 'allowance.perPurchase', {}),
        PER_PAYMENT_PRESETS,
        model.perPayment,
        (value) => value,
        (value) => Message.SelectedPerPayment({ value }),
        signing,
        h,
      ),
      h.div(
        [h.Class(fieldsetClassName)],
        [
          h.p([h.Class(legendClassName)], [format(locale, 'allowance.where', {})]),
          h.p([h.Class(payeeClassName)], [h.span([h.AriaHidden(true)], ['✓']), inputs.payeeName]),
        ],
      ),
      segments(
        'hours',
        format(locale, 'allowance.for', {}),
        HOUR_PRESETS,
        model.hours,
        (value) => hoursLabel(value, locale),
        (value) => Message.SelectedHours({ value }),
        signing,
        h,
      ),
      h.p(
        [h.Class(summaryClassName)],
        [
          format(locale, 'allowance.summary', {
            name: inputs.robotName,
            daily: model.daily,
            perPayment: model.perPayment,
            payee: inputs.payeeName,
            hours: Number(model.hours),
          }),
        ],
      ),
      Step.guards.Failed(model.step)
        ? h.p([h.Role('alert'), h.Class('text-error')], [failureText(model.step.failure, locale)])
        : h.empty,
      h.button(
        [
          h.Type('button'),
          h.Class(primaryClassName),
          h.Disabled(signing || Option.isNone(model.maybePayTo)),
          h.OnClick(Message.ClickedConfirm()),
        ],
        [format(locale, signing ? 'allowance.signing' : 'allowance.confirm', {})],
      ),
      inputs.grant === null
        ? h.empty
        : h.button(
            [h.Type('button'), h.Class(secondaryClassName), h.OnClick(Message.ClickedCancel())],
            [format(locale, 'common.cancel', {})],
          ),
    ],
  )
}

const rules = (model: Model, grant: ActiveGrant, inputs: ViewInputs, h: HtmlBuilder<Message>): Html => {
  const { locale } = inputs
  const stopping = Stop.guards.Signing(model.stop)
  return h.div(
    [h.Class(formClassName)],
    [
      h.p(
        [h.Class(leftClassName)],
        [
          usdc(grant.dailyCap),
          h.span(
            [h.Class('ml-1.5 font-sans text-base font-normal text-muted')],
            [format(locale, 'allowance.aDay', {})],
          ),
        ],
      ),
      h.ul(
        [h.Class(rulesClassName)],
        [
          h.li([], [format(locale, 'allowance.rulePerPurchase', { amount: usdc(grant.perPaymentCap) })]),
          h.li([], [format(locale, 'allowance.ruleWhere', { payee: inputs.payeeName })]),
          h.li(
            [],
            [
              format(locale, 'allowance.ruleUntil', {
                time: clockTime(grant.expiresAt * 1000, locale, inputs.timeZone),
              }),
            ],
          ),
          h.li(
            [],
            [
              format(locale, 'allowance.ruleAsks', {
                perPayment: usdc(grant.perPaymentCap),
                daily: usdc(grant.dailyCap),
              }),
            ],
          ),
        ],
      ),
      h.button(
        [h.Type('button'), h.Class(secondaryClassName), h.OnClick(Message.ClickedChange())],
        [format(locale, 'allowance.change', {})],
      ),
      h.button(
        [
          h.Type('button'),
          h.Class(stopClassName),
          h.Disabled(stopping),
          h.OnClick(Message.ClickedStop({ grantId: grant.id })),
        ],
        [format(locale, stopping ? 'allowance.stopping' : 'allowance.stop', { name: inputs.robotName })],
      ),
      Stop.guards.Failed(model.stop)
        ? h.p([h.Role('alert'), h.Class('text-error')], [failureText(model.stop.failure, locale)])
        : h.empty,
      h.p([h.Class(noteClassName)], [format(locale, 'allowance.arcNote', {})]),
    ],
  )
}

/** The allowance: the active grant's rules with Change and Stop, or the presets the passkey signs. */
export const allowanceView = Submodel.defineView<Model, Message, ViewInputs>((model, inputs, h) =>
  inputs.grant !== null && inputs.grant.status === 'active' && !model.editing
    ? rules(model, inputs.grant, inputs, h)
    : form(model, inputs, h),
)
