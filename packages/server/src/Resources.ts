import * as Cloudflare from '@alchemy.run/cloudflare'

/** The app's Cloudflare data plane. Physical names derive from the `EthMumbai` stack and its stage. */
export const StyldDatabase = Cloudflare.D1.Database('Database', {
  migrations: 'packages/db/migrations',
})

export const StyldMedia = Cloudflare.R2.Bucket('Media', {
  jurisdiction: 'eu',
})
