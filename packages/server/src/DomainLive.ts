import * as DomainCloudflare from '@alchemy.run/cloudflare/Domain'
import { Styld } from '@styld/domain/Styld.model'
import { Layer } from 'effect'

export const DomainLive = Styld.layer(Layer.empty).pipe(Layer.provide(DomainCloudflare.DurableObjects))
