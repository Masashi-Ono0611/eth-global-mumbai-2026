import * as DomainCloudflare from '@alchemy.run/cloudflare/Domain'
import { EthMumbai } from '@ethmumbai/domain/EthMumbai.model'
import { Layer } from 'effect'

export const DomainLive = EthMumbai.layer(Layer.empty).pipe(Layer.provide(DomainCloudflare.DurableObjects))
