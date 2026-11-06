import * as Cloudflare from '@alchemy.run/cloudflare'
import { Stage } from 'alchemy'
import { retain } from 'alchemy/RemovalPolicy'
import { Effect } from 'effect'
import { PRODUCTION_NAMES, pinnedOnMain } from './ProductionNames.ts'

/** On the live stage (`main`) a stack teardown keeps the data; test and preview stages still clean up after themselves. */
const keepOnMain = retain(Effect.map(Stage, (stage) => stage === 'main'))

/** The app's Cloudflare data plane. Physical names derive from the `EthMumbai` stack and its stage, pinned on `main`. */
export const AppDatabase = Cloudflare.D1.Database(
  'Database',
  Effect.map(pinnedOnMain(PRODUCTION_NAMES.database), (pin) => ({ migrations: 'packages/db/migrations', ...pin })),
).pipe(keepOnMain)

export const AppMedia = Cloudflare.R2.Bucket(
  'Media',
  Effect.map(pinnedOnMain(PRODUCTION_NAMES.media), (pin) => ({ jurisdiction: 'eu' as const, ...pin })),
).pipe(keepOnMain)
