import { Stage } from 'alchemy'
import { Effect } from 'effect'

/**
 * The live stage's physical resource names, pinned (6 Nov 2026). Alchemy derives names from a random per-resource
 * instance id kept in the state store; when the store's state became unreadable (a CI deploy re-bootstrapped the store
 * and regenerated its encryption key), a fresh state would have minted new names and created a second app. Pinned,
 * a deploy with no prior state adopts these exact Workers, D1 and R2 instead. Other stages keep generated names.
 */
export const PRODUCTION_NAMES = {
  api: 'ethmumbai-api-main-xti5wq4izrt5valv',
  edge: 'ethmumbai-edge-main-3vwjnhueh7xtsffr',
  website: 'ethmumbai-website-main-7fz7xvbge3kqkwmq',
  database: 'EthMumbai-Database-main-y3ywtsqwfzjmxzze',
  media: 'ethmumbai-media-main-sgg4y4xigwywqc7z',
} as const

/** `{ name }` on stage `main`, nothing elsewhere: spread into a resource's props. */
export const pinnedOnMain = (name: string) =>
  Effect.map(Stage, (stage): { readonly name?: string } => (stage === 'main' ? { name } : {}))
