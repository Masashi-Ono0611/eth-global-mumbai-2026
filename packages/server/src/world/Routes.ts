import { Layer } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import { requireSession } from '../auth/Session.ts'
import { answerWalletErrors } from '../wallet/Errors.ts'
import { approvalForEpisode, authorize, denyByOwner, readApprovalView, type WorldDeps } from './Authorize.ts'
import { callback } from './Callback.ts'

export type { WorldDeps } from './Authorize.ts'

/** World approval (spec §9): the approval page's data, the owner's own deny, the IdP redirect and its callback. The
 * callback needs no session: the approval is bound by its single-use OIDC `state` and the token's `nonce`. */
export const worldRoutes = (deps: WorldDeps) =>
  Layer.mergeAll(
    HttpRouter.add('GET', '/api/approvals/:id', requireSession(answerWalletErrors(readApprovalView(deps)))),
    HttpRouter.add('POST', '/api/approvals/:id/deny', requireSession(answerWalletErrors(denyByOwner(deps)))),
    HttpRouter.add(
      'GET',
      '/api/episodes/:episodeId/approval',
      requireSession(answerWalletErrors(approvalForEpisode(deps))),
    ),
    HttpRouter.add('GET', '/api/world/authorize', requireSession(answerWalletErrors(authorize(deps)))),
    HttpRouter.add('GET', '/api/world/callback', callback(deps)),
  )
