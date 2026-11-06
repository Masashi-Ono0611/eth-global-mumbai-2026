import { format, type Locale } from '@ethmumbai/i18n'
import { Dialog } from '@foldkit/ui'
import type { Html, HtmlBuilder } from 'foldkit/html'
import type { ConsoleRobot } from '../api/Robot.ts'
import type { Catalogue } from '../api/Wallet.ts'
import { sheetTitleClassName, sheetView } from '../Sheet.ts'
import { allowanceView } from './AllowanceView.ts'
import { Message, type Model } from './RobotConsole.ts'

/** The robot's allowance as a sheet over its conversation: what it may spend today, the rules, and Stop. */
export const allowanceSheet = (
  model: Model,
  view: ConsoleRobot,
  catalogue: Catalogue,
  locale: Locale,
  timeZone: string,
  h: HtmlBuilder<Message>,
): Html => {
  const name = view.robot.name
  const active = view.grant !== null && view.grant.status === 'active'
  return h.submodel({
    slotId: model.allowanceSheet.id,
    model: model.allowanceSheet,
    view: Dialog.view,
    viewInputs: {
      hasDescription: false,
      toView: (render: Dialog.RenderInfo) =>
        sheetView(
          render,
          [
            h.h2(
              [...render.title, h.Class(sheetTitleClassName)],
              [format(locale, active ? 'allowance.title' : 'allowance.give', { name })],
            ),
            h.submodel({
              slotId: `allowance-${view.robot.id}`,
              model: model.allowance,
              view: allowanceView,
              viewInputs: {
                locale,
                timeZone,
                robotName: name,
                payeeName: catalogue.name,
                grant: view.grant,
                robot: { chipAddress: view.robot.chipAddress, pairedAt: view.robot.pairedAt ?? null },
              },
              toParentMessage: (message) => Message.GotAllowanceMessage({ message }),
            }),
          ],
          format(locale, 'allowance.close', {}),
          h,
        ),
    },
    toParentMessage: (message) => Message.GotAllowanceSheetMessage({ message }),
  })
}
