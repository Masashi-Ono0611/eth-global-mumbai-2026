import { Layer } from 'effect'
import { activityRoutes } from './Activity.ts'
import type { WalletDeps } from './Deps.ts'
import { grantsRoutes } from './Grants.ts'
import { revokeRoutes } from './Revoke.ts'
import { robotsRoutes } from './Robots.ts'

export type { WalletDeps } from './Deps.ts'

/** The owner's wallet API (spec §4, §6): robots and pairing codes, grants signed by the passkey, revoke, balance and
 * activity. Every route needs a session; every mutating one also needs `Origin == AUTH_ORIGIN`. */
export const walletRoutes = (deps: WalletDeps) =>
  Layer.mergeAll(robotsRoutes(deps.database), grantsRoutes(deps), revokeRoutes(deps), activityRoutes(deps))
