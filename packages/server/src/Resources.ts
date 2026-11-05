import * as Cloudflare from '@alchemy.run/cloudflare'
import { Stage } from 'alchemy'
import { retain } from 'alchemy/RemovalPolicy'
import { Effect } from 'effect'

/** On the live stage (`main`) a stack teardown keeps the data; test and preview stages still clean up after themselves. */
const keepOnMain = retain(Effect.map(Stage, (stage) => stage === 'main'))

/** The app's Cloudflare data plane. Physical names derive from the `EthMumbai` stack and its stage. */
export const StyldDatabase = Cloudflare.D1.Database('Database', {
  migrations: 'packages/db/migrations',
}).pipe(keepOnMain)

export const StyldMedia = Cloudflare.R2.Bucket('Media', {
  jurisdiction: 'eu',
}).pipe(keepOnMain)
