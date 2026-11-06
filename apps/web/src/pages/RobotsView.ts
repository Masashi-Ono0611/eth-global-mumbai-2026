import { format, type Locale } from '@ethmumbai/i18n'
import { Option } from 'effect'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { ActionFailure } from '../api/OwnerAction.ts'
import { explorerTx, type GrantView, type RobotView, usdc } from '../api/Wallet.ts'
import {
  Adding,
  addresses,
  type GrantForm,
  GrantStep,
  type Merchant,
  Message,
  type Model,
  Revoking,
  RobotsState,
} from './Robots.ts'
import { robotConsoleRouter, walletRouter } from '../route.ts'
import { failedView, loadingView, signedOutView } from './Shared.ts'

// VIEW

const failureText = (failure: ActionFailure, locale: Locale) =>
  ActionFailure.match(failure, {
    Passkey: () => format(locale, 'auth.passkeyFailed', {}),
    Server: ({ error }) => format(locale, 'common.errorDetail', { message: error }),
  })

const addRobotView = (model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const busy = Adding.guards.Adding(model.adding)
  return h.section(
    [h.Class('add-robot')],
    [
      h.form(
        [h.Class('auth-form'), h.OnSubmit(Message.SubmittedRobot()), h.AriaBusy(busy)],
        [
          h.label([h.For('robot-name')], [format(locale, 'robots.name', {})]),
          h.input([
            h.Id('robot-name'),
            h.Type('text'),
            h.Required(true),
            h.Maxlength(40),
            h.Value(model.newRobotName),
            h.Readonly(busy),
            h.OnInput((value) => Message.UpdatedRobotName({ value })),
          ]),
          h.button([h.Type('submit'), h.Disabled(busy), h.Class('primary-action')], [format(locale, 'robots.add', {})]),
        ],
      ),
      Adding.match(model.adding, {
        Idle: () => h.empty,
        Adding: () => h.empty,
        Added: ({ robot }) =>
          h.div(
            [h.Class('pairing-card'), h.Role('status')],
            [
              h.p([], [format(locale, 'robots.pairWith', { name: robot.name })]),
              h.code([h.Class('pairing-code')], [robot.pairingCode]),
              h.p([h.Class('hint')], [format(locale, 'robots.pairHint', { code: robot.pairingCode })]),
            ],
          ),
        Failed: ({ error }) =>
          h.p([h.Role('alert'), h.Class('form-error')], [format(locale, 'common.errorDetail', { message: error })]),
      }),
    ],
  )
}

const grantSummary = (grant: GrantView, model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const signing = Revoking.guards.Signing(model.revoking) && model.revoking.grantId === grant.id
  const failed = Revoking.guards.Failed(model.revoking) && model.revoking.grantId === grant.id
  return h.div(
    [h.Class('grant-summary')],
    [
      h.p(
        [],
        [
          format(locale, 'robots.grantTerms', {
            daily: usdc(grant.dailyCap),
            perPayment: usdc(grant.perPaymentCap),
            status: grant.status,
          }),
        ],
      ),
      h.p([h.Class('hint')], [format(locale, 'robots.allowlist', { payees: grant.allowlist.join(', ') })]),
      grant.revokeTx === undefined || grant.revokeTx === null
        ? h.empty
        : h.a([h.Href(explorerTx(grant.revokeTx)), h.Class('tx-link')], [format(locale, 'robots.revokeTx', {})]),
      grant.status === 'active'
        ? h.button(
            [
              h.Type('button'),
              h.Class('secondary-action'),
              h.Disabled(signing),
              h.OnClick(Message.ClickedRevoke({ grantId: grant.id })),
            ],
            [format(locale, signing ? 'robots.revoking' : 'robots.revoke', {})],
          )
        : h.empty,
      failed && Revoking.guards.Failed(model.revoking)
        ? h.p([h.Role('alert'), h.Class('form-error')], [failureText(model.revoking.failure, locale)])
        : h.empty,
    ],
  )
}

/** The grant read back as one sentence before the passkey signs it: caps, payees, window, who enforces it. */
const consentView = (
  form: GrantForm,
  maybeMerchant: Option.Option<Merchant>,
  locale: Locale,
  h: HtmlBuilder<Message>,
) => {
  const hours = Number(form.hours)
  if (!Number.isInteger(hours) || hours < 1 || hours > 720) return h.empty
  const payees = addresses(form.allowlist)
  const onlyMerchant = Option.match(maybeMerchant, {
    onNone: () => Option.none<string>(),
    onSome: ({ name, payTo }) =>
      payees.length === 1 && payees[0]?.toLowerCase() === payTo.toLowerCase() ? Option.some(name) : Option.none(),
  })
  return h.p(
    [h.Class('consent')],
    [
      format(locale, 'robots.consent', {
        daily: form.dailyCap,
        perPayment: form.perPaymentCap,
        payees: Option.getOrElse(onlyMerchant, () => payees.join(', ')),
        hours,
      }),
    ],
  )
}

const grantFormView = (
  form: GrantForm,
  maybeMerchant: Option.Option<Merchant>,
  locale: Locale,
  h: HtmlBuilder<Message>,
): Html => {
  const signing = GrantStep.guards.Signing(form.step)
  const field = (id: string, label: string, value: string, toMessage: (value: string) => Message) => [
    h.label([h.For(id)], [label]),
    h.input([h.Id(id), h.Type('text'), h.Value(value), h.Readonly(signing), h.OnInput(toMessage)]),
  ]
  return h.form(
    [h.Class('auth-form grant-form'), h.OnSubmit(Message.SubmittedGrant()), h.AriaBusy(signing)],
    [
      ...field('grant-daily', format(locale, 'robots.dailyCap', {}), form.dailyCap, (value) =>
        Message.UpdatedDailyCap({ value }),
      ),
      ...field('grant-per-payment', format(locale, 'robots.perPaymentCap', {}), form.perPaymentCap, (value) =>
        Message.UpdatedPerPaymentCap({ value }),
      ),
      ...field('grant-allowlist', format(locale, 'robots.allowlistLabel', {}), form.allowlist, (value) =>
        Message.UpdatedAllowlist({ value }),
      ),
      ...field('grant-hours', format(locale, 'robots.hours', {}), form.hours, (value) =>
        Message.UpdatedHours({ value }),
      ),
      consentView(form, maybeMerchant, locale, h),
      GrantStep.guards.Failed(form.step)
        ? h.p([h.Role('alert'), h.Class('form-error')], [failureText(form.step.failure, locale)])
        : h.empty,
      h.button(
        [h.Type('submit'), h.Disabled(signing), h.Class('primary-action')],
        [format(locale, signing ? 'robots.signingGrant' : 'robots.signGrant', {})],
      ),
      h.button(
        [h.Type('button'), h.Disabled(signing), h.Class('secondary-action'), h.OnClick(Message.ClickedCancelGrant())],
        [format(locale, 'common.cancel', {})],
      ),
    ],
  )
}

const robotCard = (robot: RobotView, model: Model, locale: Locale, h: HtmlBuilder<Message>): Html => {
  const maybeForm = Option.filter(model.maybeGrantForm, (form) => form.robotId === robot.id)
  const canGrant = robot.status === 'paired' && (robot.grant === null || robot.grant.status !== 'active')
  return h.keyed('li')(
    robot.id,
    [h.Class('robot-card')],
    [
      h.h2([], [robot.name]),
      h.p(
        [h.Class(robot.lease.online ? 'online' : 'offline')],
        [format(locale, 'robots.status', { status: robot.status, online: robot.lease.online ? 'yes' : 'no' })],
      ),
      robot.chipAddress === null ? h.empty : h.code([h.Class('chip-address')], [robot.chipAddress]),
      robot.pairingCode === null
        ? h.empty
        : h.p([], [format(locale, 'robots.pairingCode', { code: robot.pairingCode })]),
      robot.grant === null ? h.empty : grantSummary(robot.grant, model, locale, h),
      Option.match(maybeForm, {
        onSome: (form) => grantFormView(form, model.maybeMerchant, locale, h),
        onNone: () =>
          canGrant
            ? h.button(
                [
                  h.Type('button'),
                  h.Class('primary-action'),
                  h.OnClick(Message.ClickedGrantBudget({ robotId: robot.id })),
                ],
                [format(locale, 'robots.grantBudget', {})],
              )
            : h.empty,
      }),
      robot.status === 'paired'
        ? h.a(
            [h.Href(robotConsoleRouter({ robotId: robot.id })), h.Class('secondary-action')],
            [format(locale, 'robots.openConsole', {})],
          )
        : h.empty,
    ],
  )
}

/** `/wallet/robots`: add a robot (pairing code), grant it a budget with the passkey, revoke it. */
export const robotsView = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) =>
  h.main(
    [h.Id('main'), h.Class('owner-page')],
    [
      h.h1([], [format(locale, 'robots.title', {})]),
      RobotsState.match(model.robots, {
        Loading: () => loadingView(locale, h),
        SignedOut: () => signedOutView(locale, h),
        Failed: ({ error }) => failedView(error, Message.ClickedReload(), locale, h),
        Loaded: ({ robots }) =>
          h.div(
            [],
            [
              addRobotView(model, locale, h),
              robots.length === 0
                ? h.p([h.Class('empty-state')], [format(locale, 'robots.none', {})])
                : h.ul(
                    [h.Class('robot-list')],
                    robots.map((robot) => robotCard(robot, model, locale, h)),
                  ),
              h.button(
                [h.Type('button'), h.Class('secondary-action'), h.OnClick(Message.ClickedReload())],
                [format(locale, 'common.refresh', {})],
              ),
              h.a([h.Href(walletRouter()), h.Class('secondary-action')], [format(locale, 'wallet.title', {})]),
            ],
          ),
      }),
    ],
  ),
)
