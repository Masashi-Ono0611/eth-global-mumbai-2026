import * as Domain from '@alchemy.run/domain'
import { Wallet } from './Wallet/Wallet.aggregate.ts'
export class Styld extends Domain.Model('Styld', { aggregates: [Wallet] }) {}
