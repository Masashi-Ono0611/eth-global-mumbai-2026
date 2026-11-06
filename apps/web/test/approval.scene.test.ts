import { Command, click, expect, given, role, scene, text, withViewInputs } from 'foldkit/scene'
import { describe, expect as expectValue, test } from 'vitest'
import * as Approval from '../src/pages/Approval.ts'

const robotId = 'robotrobotrobotrobotrobota'
const episodeId = 'episodeepisodeepisodeepisa'
const txHash = `0x${'ab'.repeat(32)}`

const approval = (status: string, error: string | null = null) => ({
  id: 'ap1',
  status,
  error,
  item: 'cigarettes',
  robotName: 'Duck',
  robotId,
  episodeId,
  invoiceId: 'inv1',
  payee: '0x000000000000000000000000000000000000dead',
  amount: '500000',
  closesAt: 0,
  reasons: { restricted: true, overCap: false, offList: true, perPaymentCap: '1000000' },
  worldConfigured: true,
})

const loaded = (status: string, error: string | null = null) =>
  Approval.update(
    Approval.init('ap1').model,
    Approval.Message.SucceededLoadApproval({ approval: approval(status, error) }),
  ).model

/** The page as it opens after World's callback: one read of the approval, already answered. */
const reloadedAs = (status: string) => [
  given(
    Approval.update(
      Approval.init('ap1').model,
      Approval.Message.FailedLoadApproval({ error: 'offline', signedOut: false }),
    ).model,
  ),
  click(role('button', { name: 'Retry' })),
  Command.resolve(Approval.LoadApproval, Approval.Message.SucceededLoadApproval({ approval: approval(status) })),
]

const follow = (delayMillis: number) => Approval.FollowErrand({ robotId, episodeId, delayMillis })
const ended = (state: string, end: { readonly txHash?: string; readonly reason?: string } = {}) =>
  Approval.Message.FollowedErrand({ state, txHash: end.txHash ?? null, reason: end.reason ?? null })

/** One read of a still-running errand. */
const tick = (model: Approval.Model) => Approval.update(model, ended('signing'))
const commandNames = (commands: ReturnType<typeof tick>['commands']) => (commands ?? []).map((command) => command.name)

describe('/wallet/approvals/:id', () => {
  const view = withViewInputs(Approval.view, { locale: 'en' })()

  test('a restricted item asks for World approval; the owner can deny it and the page ends on the denial', () => {
    scene(
      { update: Approval.update, view },
      given(Approval.init('ap1').model),
      expect(role('status')).toHaveText('Loading...'),
    )
    scene(
      { update: Approval.update, view },
      given(loaded('requested')),
      expect(role('heading', { name: 'Approval for a restricted item' })).toExist(),
      expect(text('cigarettes · Duck')).toExist(),
      expect(text('0.50 USDC')).toExist(),
      expect(role('status')).toHaveText('Waiting for your answer'),
      expect(role('link', { name: 'Approve with World' })).toHaveAttr('href', '/api/world/authorize?approval=ap1'),
      click(role('button', { name: 'Deny' })),
      Command.expectExact(Approval.DenyApproval({ approvalId: 'ap1' })),
      Command.resolve(Approval.DenyApproval, Approval.Message.SucceededDenyApproval()),
      Command.expectExact(Approval.LoadApproval({ approvalId: 'ap1', delayMillis: 0 })),
      Command.resolve(
        Approval.LoadApproval,
        Approval.Message.SucceededLoadApproval({ approval: approval('denied', 'denied by the owner') }),
      ),
      Command.expectExact(follow(0)),
      Command.resolve(Approval.FollowErrand, ended('denied', { reason: 'denied by the owner' })),
      expect(role('status')).toHaveText('Denied: nothing is paid'),
      expect(text('denied by the owner')).toExist(),
      expect(role('link', { name: 'Approve with World' })).toBeAbsent(),
      expect(role('link', { name: 'Open console' })).toHaveAttr('href', `/robot/${robotId}`),
    )
  })

  test('after World approves, the page follows the errand until it is paid and links the payment on Arc', () => {
    scene(
      { update: Approval.update, view },
      ...reloadedAs('approved'),
      expect(role('status')).toHaveText('Approved: the chip signs the payment now'),
      expect(text("Following the robot's payment…")).toExist(),
      expect(role('button', { name: 'Deny' })).toBeAbsent(),
      Command.expectExact(follow(0)),
      Command.resolve(Approval.FollowErrand, ended('signing')),
      Command.expectExact(follow(2000)),
      Command.resolve(Approval.FollowErrand, ended('paid', { txHash })),
      expect(role('status')).toHaveText('Paid · view on Arc'),
      expect(role('link', { name: 'view on Arc' })).toHaveAttr('href', `https://explorer.arc.io/tx/${txHash}`),
      expect(role('link', { name: 'Open console' })).toHaveAttr('href', `/robot/${robotId}`),
    )
  })

  test('an approved payment that fails on Arc ends with the reason, nothing paid', () => {
    scene(
      { update: Approval.update, view },
      ...reloadedAs('approved'),
      Command.resolve(Approval.FollowErrand, ended('failed', { reason: 'CannotUseADisabledDelegation' })),
      expect(role('status')).toHaveText('The payment failed: nothing is paid'),
      expect(text('CannotUseADisabledDelegation')).toExist(),
      expect(role('link', { name: 'view on Arc' })).toBeAbsent(),
      expect(role('link', { name: 'Open console' })).toHaveAttr('href', `/robot/${robotId}`),
    )
  })

  test('after 2 minutes without an end the page stops reading and points at the console', () => {
    const started = Approval.update(loaded('approved'), Approval.Message.FailedFollowErrand())
    const last = Array.from({ length: 58 }).reduce<Approval.Model>((model) => tick(model).model, started.model)
    const stopped = tick(last)
    expectValue(commandNames(tick(started.model).commands)).toEqual(['FollowErrand'])
    expectValue(commandNames(stopped.commands)).toEqual([])
    scene(
      { update: Approval.update, view },
      given(stopped.model),
      expect(text('No final state after 2 minutes; the console shows the latest.')).toExist(),
      expect(role('link', { name: 'Open console' })).toHaveAttr('href', `/robot/${robotId}`),
    )
  })

  test('a payment over the per-payment limit to an allowlisted payee says so (2.00 > 1.00), same approve and deny', () => {
    const thali = {
      ...approval('requested'),
      item: 'thali',
      amount: '2000000',
      reasons: { restricted: false, overCap: true, offList: false, perPaymentCap: '1000000' },
    }
    scene(
      { update: Approval.update, view },
      given(
        Approval.update(Approval.init('ap1').model, Approval.Message.SucceededLoadApproval({ approval: thali })).model,
      ),
      expect(role('heading', { name: 'Approval for a payment over the limit' })).toExist(),
      expect(
        text(
          "This payment is over the robot's per-payment limit (2.00 > 1.00 USDC), so it needs your fresh approval in World App. Nothing is paid without it.",
        ),
      ).toExist(),
      expect(text('restricted', { exact: false })).toBeAbsent(),
      expect(text('thali · Duck')).toExist(),
      expect(role('link', { name: 'Approve with World' })).toHaveAttr('href', '/api/world/authorize?approval=ap1'),
      expect(role('button', { name: 'Deny' })).toExist(),
    )
  })
})
