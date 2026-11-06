import type { QueryDatabaseClient } from '@alchemy.run/cloudflare/D1/QueryDatabase'
import type { ArcClient } from '@ethmumbai/chain/Arc'
import type { Relayer } from '@ethmumbai/chain/Relayer'
import type { Option } from 'effect'
import type { Address } from 'viem'

/** What the wallet routes need beyond D1. Each is optional: a missing binding makes only the routes that need it
 * answer 503 `not configured: <name>` (spec §10). The relayer is the same instance the facilitator settles with. */
export interface WalletDeps {
  readonly database: QueryDatabaseClient
  readonly arc: Option.Option<ArcClient>
  readonly relayer: Option.Option<Relayer>
  /** `APP_ENFORCER_ADDRESS`: the RobotPaymentPolicyEnforcer on Arc. */
  readonly enforcer: Option.Option<Address>
  /** The approver's address (from `APPROVER_PRIVATE_KEY`): the enforcer term that signs approvals. */
  readonly approver: Option.Option<Address>
}
