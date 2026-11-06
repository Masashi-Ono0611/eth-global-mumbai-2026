import { Option } from 'effect'
import { withViewInputs } from 'foldkit/scene'
import type { EpisodeSummary } from '../src/api/Episodes.ts'
import type { ConsoleRobot } from '../src/api/Robot.ts'
import * as RobotConsole from '../src/pages/RobotConsole.ts'
import { robotConsoleView } from '../src/pages/RobotConsoleView.ts'
import { grant, pairedRobot, payee } from './Fixtures.ts'

/** The robot conversation's scene fixtures: Duck, paired, with an allowance, at Duck Café. */

export const consoleView = withViewInputs(robotConsoleView, { locale: 'en', timeZone: 'UTC' })()
export const robotId = pairedRobot.id
export const consoleRobot: ConsoleRobot = {
  robot: { id: robotId, name: 'Duck', status: 'paired', chipAddress: pairedRobot.chipAddress },
  lease: { until: 1, online: true },
  grant,
}
const catalogue = {
  merchantId: 'duck-cafe',
  name: 'Duck Café',
  payTo: payee,
  items: [
    { itemId: 'chai', name: 'Chai', amount: '100000', restricted: false },
    { itemId: 'samosa', name: 'Samosa', amount: '250000', restricted: false },
    { itemId: 'thali', name: 'Thali', amount: '2000000', restricted: false },
  ],
}
export const loadedConsole = (history: ReadonlyArray<EpisodeSummary> = [], robot: ConsoleRobot = consoleRobot) =>
  RobotConsole.update(
    RobotConsole.init(robotId).model,
    RobotConsole.Message.SucceededLoadConsole({
      robot,
      catalogue,
      history,
      amounts: { e1: '100000' },
      maybeLatestEpisode: Option.none(),
    }),
  ).model
