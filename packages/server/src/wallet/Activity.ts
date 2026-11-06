import { rpc } from '@ethmumbai/chain/Arc'
import { USDC } from '@ethmumbai/chain/Env'
import { Effect, Layer, Option, Schema } from 'effect'
import * as HttpRouter from 'effect/http/HttpRouter'
import { getAddress, parseAbi } from 'viem'
import { CurrentSession, requireSession } from '../auth/Session.ts'
import { json } from '../Respond.ts'
import { GrantRow } from '../robot/Budget.ts'
import { allRows } from '../Sql.ts'
import { readOwner } from './Account.ts'
import type { WalletDeps } from './Deps.ts'
import { grantView } from './Robots.ts'

const erc20 = parseAbi(['function balanceOf(address owner) view returns (uint256)'])

/** USDC base units (6 dp) as a fixed-point text, e.g. 1230000 → "1.23". */
export const formatUsdc = (units: bigint): string => {
  const whole = units / 1_000_000n
  const fraction = (units % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return fraction.length === 0 ? `${whole}.00` : `${whole}.${fraction.padEnd(2, '0')}`
}

/** `GET /api/wallet` → the account, its USDC balance on Arc (null while ARC_RPC_URL is unset or Arc does not answer),
 * and how to fund it: send USDC on Arc mainnet to the smart account (its address exists before the deploy). */
const wallet = (deps: WalletDeps) =>
  Effect.gen(function* () {
    const session = yield* CurrentSession
    const owner = yield* readOwner(deps.database, session.accountId)
    const balance = yield* Option.match(deps.arc, {
      onNone: () => Effect.succeedNone,
      onSome: (arc) =>
        rpc('balanceOf', () =>
          arc.readContract({
            address: USDC,
            abi: erc20,
            functionName: 'balanceOf',
            args: [getAddress(owner.smart_account)],
          }),
        ).pipe(
          Effect.map((units) => Option.some({ units: units.toString(), usdc: formatUsdc(units) })),
          Effect.catchTag('ArcRpcError', ({ message }) =>
            Effect.as(Effect.logWarning('balance read failed', { message }), Option.none()),
          ),
        ),
    })
    return yield* json({
      account: {
        accountId: owner.id,
        displayName: owner.display_name,
        smartAccount: owner.smart_account,
        deployStatus: owner.deploy_status,
        deployTx: owner.deploy_tx,
      },
      balance: Option.getOrNull(balance),
      fund: { network: 'eip155:5042', asset: USDC, address: owner.smart_account },
    })
  })

const EpisodeActivity = Schema.Struct({
  id: Schema.String,
  robot_id: Schema.String,
  robot_name: Schema.String,
  item: Schema.String,
  state: Schema.String,
  result: Schema.NullOr(Schema.String),
  created_at: Schema.Finite,
  amount: Schema.NullOr(Schema.String),
  pay_to: Schema.NullOr(Schema.String),
  tx_hash: Schema.NullOr(Schema.String),
  payment_status: Schema.NullOr(Schema.String),
})

/** `GET /api/wallet/activity` → the owner's latest errands (with their payment) and grants, newest first. */
const activity = (deps: WalletDeps) =>
  Effect.gen(function* () {
    const session = yield* CurrentSession
    const episodes = yield* allRows(
      deps.database
        .prepare(
          `SELECT e.id, e.robot_id, r.name AS robot_name, e.item, e.state, e.result, e.created_at,
             i.amount, i.pay_to, p.tx_hash, p.status AS payment_status
           FROM episodes e JOIN robots r ON r.id = e.robot_id
             LEFT JOIN invoices i ON i.id = e.invoice_id LEFT JOIN payments p ON p.episode_id = e.id
           WHERE e.account_id = ? ORDER BY e.created_at DESC LIMIT 50`,
        )
        .bind(session.accountId),
      EpisodeActivity,
    )
    const grants = yield* allRows(
      deps.database
        .prepare("SELECT * FROM grants WHERE account_id = ? AND status != 'unsigned' ORDER BY created_at DESC LIMIT 20")
        .bind(session.accountId),
      GrantRow,
    )
    return yield* json({
      episodes: episodes.map((row) => ({
        id: row.id,
        robotId: row.robot_id,
        robotName: row.robot_name,
        item: row.item,
        state: row.state,
        result: row.result,
        createdAt: row.created_at,
        amount: row.amount,
        payTo: row.pay_to,
        txHash: row.tx_hash,
        paymentStatus: row.payment_status,
      })),
      grants: yield* Effect.forEach(grants, (row) =>
        Effect.map(grantView(row), (view) => ({ ...view, robotId: row.robot_id })),
      ),
    })
  })

export const activityRoutes = (deps: WalletDeps) =>
  Layer.mergeAll(
    HttpRouter.add('GET', '/api/wallet', requireSession(wallet(deps))),
    HttpRouter.add('GET', '/api/wallet/activity', requireSession(activity(deps))),
  )
