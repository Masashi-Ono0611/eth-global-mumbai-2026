import { format, type Locale } from '@ethmumbai/i18n'
import { Submodel } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { simulatorUrl } from '../api/Robot.ts'
import type { AddedRobot } from '../api/Wallet.ts'
import { duck } from '../Duck.ts'
import { walletRouter } from '../route.ts'
import { bubbleSkeleton } from '../Skeleton.ts'
import { Message, type Model, Stage } from './AddRobot.ts'
import { allowanceView } from './AllowanceView.ts'
import { failedView, signedOutView } from './Shared.ts'
import { workingDots } from '../Busy.ts'

// STYLES

const pageClassName = 'flex flex-col'
const headerClassName = 'grid grid-cols-[44px_44px_1fr] items-center gap-2.5 border-b border-rule px-1 pt-1 pb-2.5'
const closeClassName =
  'grid size-11 place-items-center rounded-full bg-surface text-xl no-underline transition-transform active:scale-[0.96]'
const faceClassName = 'grid size-11 place-items-center rounded-full bg-rule'
const titleClassName = 'pt-1 font-display text-xl leading-none font-bold'
const subtitleClassName = 'text-sm text-muted'
const threadClassName = 'flex flex-col gap-2 px-1 pt-3 pb-6'
const robotBubbleClassName = 'max-w-[86%] self-start rounded-[20px_20px_20px_6px] bg-surface px-3.5 py-2'
const duckBubbleClassName = 'max-w-[86%] self-start rounded-[20px_20px_20px_6px] bg-duck px-3.5 py-2'
const ownerBubbleClassName = 'max-w-[82%] self-end rounded-[20px_20px_6px_20px] bg-ink px-3.5 pt-2 pb-1.5 text-surface'
const systemClassName = 'self-center rounded-full bg-surface/60 px-3 py-1 text-center text-sm text-muted'
const labelClassName = 'block text-[0.8rem] text-muted'
const codeClassName = 'block font-display text-[1.9rem] leading-tight font-extrabold tracking-[0.08em]'
const commandClassName = 'mt-1 block font-mono text-[0.8rem] break-all text-ink/80'
const formClassName = 'grid grid-cols-[1fr_auto] gap-2 self-stretch'
const inputClassName =
  'min-h-12 w-full rounded-control border border-rule bg-surface px-3.5 text-base text-ink placeholder:text-muted'
const sendClassName =
  'min-h-12 cursor-pointer rounded-control bg-ink px-5 font-semibold text-surface transition-transform active:scale-[0.96] disabled:opacity-60'
const cardClassName = 'grid gap-3 self-stretch rounded-card bg-surface p-4'
const kindsClassName = 'grid grid-cols-2 gap-1 self-stretch rounded-2xl bg-surface p-1'
const kindClassName =
  'grid min-h-12 cursor-pointer place-items-center rounded-xl font-semibold text-muted has-[:checked]:bg-ink has-[:checked]:text-surface has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus'
const simButtonClassName =
  'mt-2 inline-flex min-h-11 items-center justify-center rounded-control bg-ink px-4 font-semibold text-surface no-underline transition-transform active:scale-[0.96]'
const linkButtonClassName =
  'min-h-11 cursor-pointer self-start rounded-full bg-surface px-4 font-semibold transition-transform active:scale-[0.96]'

// VIEW

const header = (locale: Locale, subtitle: string, h: HtmlBuilder<Message>): Html =>
  h.header(
    [h.Class(headerClassName)],
    [
      h.a(
        [h.Href(walletRouter()), h.Class(closeClassName), h.AriaLabel(format(locale, 'addRobot.close', {}))],
        [h.span([h.AriaHidden(true)], ['×'])],
      ),
      h.span([h.Class(faceClassName)], [duck('size-8', true, h)]),
      h.div(
        [],
        [
          h.h1([h.Class(titleClassName)], [format(locale, 'addRobot.title', {})]),
          h.span([h.Class(subtitleClassName)], [subtitle]),
        ],
      ),
    ],
  )

const nameForm = (model: Model, busy: boolean, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.form(
    [h.Class(formClassName), h.OnSubmit(Message.SubmittedName()), h.AriaBusy(busy)],
    [
      h.label([h.For('robot-name'), h.Class('sr-only')], [format(locale, 'addRobot.nameLabel', {})]),
      h.input([
        h.Id('robot-name'),
        h.Type('text'),
        h.Class(inputClassName),
        h.Required(true),
        h.Maxlength(40),
        h.Autocomplete('off'),
        h.Placeholder(format(locale, 'addRobot.namePlaceholder', {})),
        h.Value(model.name),
        h.Readonly(busy),
        h.OnInput((value) => Message.UpdatedName({ value })),
      ]),
      h.button([h.Type('submit'), h.Class(sendClassName), h.Disabled(busy)], [format(locale, 'addRobot.next', {})]),
    ],
  )

const code = (robot: AddedRobot, h: HtmlBuilder<Message>): Html =>
  h.span([h.Class(codeClassName)], [`${robot.pairingCode.slice(0, 4)} ${robot.pairingCode.slice(4)}`])

/** A real robot gets the command to run on its chip; a simulator duck pairs itself in its own tab. */
const codeBubble = (robot: AddedRobot, locale: Locale, h: HtmlBuilder<Message>): Html =>
  robot.kind === 'sim'
    ? h.div(
        [h.Class(robotBubbleClassName)],
        [
          h.span([h.Class(labelClassName)], [format(locale, 'addRobot.simCode', { name: robot.name })]),
          code(robot, h),
          h.a(
            [
              h.Href(simulatorUrl(robot.robotId, robot.pairingCode)),
              h.Target('_blank'),
              h.Rel('noopener'),
              h.Class(simButtonClassName),
            ],
            [format(locale, 'addRobot.openSimulator', {})],
          ),
        ],
      )
    : h.div(
        [h.Class(robotBubbleClassName)],
        [
          h.span([h.Class(labelClassName)], [format(locale, 'addRobot.giveCode', { name: robot.name })]),
          code(robot, h),
          h.code([h.Class(commandClassName)], [`./vitaquack-chip --pair ${robot.pairingCode}`]),
        ],
      )

/** Real robot or simulator, as two radio segments (keyboard and screen readers get a native radio group). */
const kindChoice = (model: Model, busy: boolean, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.fieldset(
    [h.Class('grid gap-1.5 self-stretch'), h.Disabled(busy)],
    [
      h.legend([h.Class('sr-only')], [format(locale, 'addRobot.kindLegend', {})]),
      h.div(
        [h.Class(kindsClassName)],
        (['chip', 'sim'] as const).map((kind) =>
          h.keyed('label')(
            kind,
            [h.Class(kindClassName), h.For(`robot-kind-${kind}`)],
            [
              h.input([
                h.Id(`robot-kind-${kind}`),
                h.Type('radio'),
                h.Name('robot-kind'),
                h.Value(kind),
                h.Checked(model.kind === kind),
                h.Class('sr-only'),
                h.OnClick(Message.SelectedKind({ kind })),
              ]),
              format(locale, kind === 'sim' ? 'addRobot.kindSim' : 'addRobot.kindChip', {}),
            ],
          ),
        ),
      ),
    ],
  )

const askName = (locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.p([h.Class(robotBubbleClassName)], [format(locale, 'addRobot.askName', {})])

const messages = (model: Model, locale: Locale, h: HtmlBuilder<Message>): ReadonlyArray<Html> =>
  Stage.match(model.stage, {
    Loading: () => [bubbleSkeleton(locale, h)],
    SignedOut: () => [signedOutView(locale, h)],
    Failed: ({ error }) => [failedView(error, Message.ClickedStartOver(), locale, h)],
    Naming: () => [askName(locale, h), kindChoice(model, false, locale, h), nameForm(model, false, locale, h)],
    Adding: () => [askName(locale, h), kindChoice(model, true, locale, h), nameForm(model, true, locale, h)],
    Pairing: ({ robot }) => [
      askName(locale, h),
      h.p([h.Class(ownerBubbleClassName)], [robot.name]),
      codeBubble(robot, locale, h),
      h.p(
        [h.Role('status'), h.Class(systemClassName)],
        [workingDots(h), format(locale, 'addRobot.waiting', { name: robot.name })],
      ),
      h.button(
        [h.Type('button'), h.Class(linkButtonClassName), h.OnClick(Message.ClickedCancelPairing())],
        [format(locale, 'addRobot.cancelPairing', {})],
      ),
    ],
    Expired: ({ robot }) => [
      h.p([h.Class(ownerBubbleClassName)], [robot.name]),
      h.p([h.Role('alert'), h.Class(robotBubbleClassName)], [format(locale, 'addRobot.expired', {})]),
      h.button(
        [h.Type('button'), h.Class(linkButtonClassName), h.OnClick(Message.ClickedStartOver())],
        [format(locale, 'addRobot.startOver', {})],
      ),
    ],
    Connected: ({ robotId, name }) => [
      h.p([h.Role('status'), h.Class(systemClassName)], [format(locale, 'addRobot.connected', { name })]),
      h.p([h.Class(duckBubbleClassName)], [format(locale, 'addRobot.hello', {})]),
      h.section(
        [h.Class(cardClassName), h.AriaLabel(format(locale, 'allowance.give', { name }))],
        [
          h.submodel({
            slotId: `allowance-${robotId}`,
            model: model.allowance,
            view: allowanceView,
            viewInputs: {
              locale,
              timeZone: 'UTC',
              robotName: name,
              payeeName: model.merchantName,
              grant: null,
              robot: null,
            },
            toParentMessage: (message) => Message.GotAllowanceMessage({ message }),
          }),
        ],
      ),
    ],
  })

const subtitle = (model: Model, locale: Locale): string =>
  format(locale, Stage.guards.Connected(model.stage) ? 'addRobot.stepAllowance' : 'addRobot.stepPair', {})

/** `/wallet/robots`: add a robot as a conversation (DESIGN.md "Components"). */
export const addRobotView = Submodel.defineView<Model, Message, { readonly locale: Locale }>((model, { locale }, h) =>
  h.main(
    [h.Id('main'), h.Class(pageClassName)],
    [header(locale, subtitle(model, locale), h), h.div([h.Class(threadClassName)], messages(model, locale, h))],
  ),
)
