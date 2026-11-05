import * as Domain from '@alchemy.run/domain'

/**
 * The app's Domain model, hosted on Durable Objects by the API Worker (`DomainLive`). It has no aggregates yet: Styld's
 * credit wallet was removed (spending authority lives on Arc, not here). Product aggregates such as robot sessions
 * or invoices are added to `aggregates` (see the `alchemy-domain` skill).
 */
export class EthMumbai extends Domain.Model('EthMumbai', { aggregates: [] }) {}
