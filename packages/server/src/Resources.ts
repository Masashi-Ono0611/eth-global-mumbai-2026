import * as Cloudflare from '@alchemy.run/cloudflare'

/**
 * v2 owns its Cloudflare data plane. These resources are intentionally named
 * independently from Styld v1 so preview deploys cannot adopt or mutate v1.
 */
export const StyldDatabase = Cloudflare.D1.Database('StyldV2Database', {
  migrations: 'packages/db/migrations',
})

export const StyldMedia = Cloudflare.R2.Bucket('StyldV2Media', {
  jurisdiction: 'eu',
})
