import { format, type Locale } from '@ethmumbai/i18n'
import { clsx } from 'clsx'
import type { Html, HtmlBuilder } from 'foldkit/html'
import type { ConsoleRobot } from '../api/Robot.ts'
import { duck } from '../Duck.ts'
import { walletRouter } from '../route.ts'
import { Message, type Model } from './RobotConsole.ts'
import * as RobotVoice from './RobotVoice.ts'
import { failedView } from './Shared.ts'

// The robot conversation's empty and failed states, kept apart from RobotConsoleView.ts (the thread) for its size.

// STYLES

const emptyClassName = 'my-auto grid justify-items-center gap-3 px-6 py-8 text-center'
// The same face as the robot's row on home: ink while its chip is on, grey (and the duck asleep) while it is off.
const emptyFaceClassName = 'grid size-24 place-items-center rounded-full'
const emptyTextClassName = 'max-w-[15rem] text-[0.95rem] text-muted text-balance'
const emptyActionClassName =
  'inline-flex min-h-11 cursor-pointer items-center rounded-full bg-ink px-5 font-semibold text-surface transition-transform active:scale-[0.96]'
const failedClassName = 'grid gap-4 px-1 pt-4'
const failedBackClassName =
  'inline-flex min-h-11 items-center gap-1.5 justify-self-start rounded-full bg-surface px-3.5 font-semibold no-underline transition-transform active:scale-[0.96]'

// VIEW

/** An empty conversation: the duck itself, waiting to be asked. Without an allowance the pills rest, so it says to
 *  give one first and offers the button that opens the allowance sheet. */
export const emptyThread = (model: Model, view: ConsoleRobot, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class(emptyClassName)],
    [
      h.span(
        [h.Class(clsx(emptyFaceClassName, view.lease.online ? 'bg-ink' : 'bg-rule')), h.AriaHidden(true)],
        [duck('size-16 motion-safe:animate-bob', !view.lease.online, h)],
      ),
      h.p(
        [h.Class(emptyTextClassName)],
        [
          format(
            locale,
            view.grant === null
              ? 'thread.emptyNoAllowance'
              : RobotVoice.Status.guards.Unavailable(model.voice.status)
                ? 'thread.empty'
                : 'voice.empty',
            { name: view.robot.name },
          ),
        ],
      ),
      view.grant === null
        ? h.button(
            [h.Type('button'), h.Class(emptyActionClassName), h.OnClick(Message.ClickedAllowance())],
            [format(locale, 'allowance.give', { name: view.robot.name })],
          )
        : h.empty,
    ],
  )

/** A robot that cannot be read (gone, or another owner's): the reason and Retry, with a way back to the wallet. */
export const failedConsole = (error: string, locale: Locale, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class(failedClassName)],
    [
      h.a(
        [h.Href(walletRouter()), h.Class(failedBackClassName)],
        [h.span([h.AriaHidden(true)], ['‹']), format(locale, 'episodes.backToWallet', {})],
      ),
      failedView(error, Message.ClickedRefresh(), locale, h),
    ],
  )
