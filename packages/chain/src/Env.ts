import { getSmartAccountsEnvironment } from '@metamask/smart-accounts-kit'
import type { Address } from 'viem'

// Every Delegation Framework address comes from the kit's deployment registry (delegation-deployments 2.1.0 = framework
// v1.3.0 on Arc). Multicall3 is the canonical cross-chain deployment, used only to simulate multi-step histories.
export const ARC_CHAIN_ID = 5042
export const arcEnvironment = getSmartAccountsEnvironment(ARC_CHAIN_ID)
export const MULTICALL3: Address = '0xcA11bde05977b3631167028862bE2a173976CA11'
/** Arc's native USDC: 18-decimal native balance, 6-decimal ERC-20 view of the same money. */
export const USDC: Address = '0x3600000000000000000000000000000000000000'
export const PERIOD_SECONDS = 86_400n

const required = (table: Readonly<Record<string, Address>>, name: string): Address => {
  const address = table[name]
  if (address === undefined) throw new Error(`Arc environment has no ${name}`)
  return address
}

export const arcAddresses = {
  delegationManager: arcEnvironment.DelegationManager,
  simpleFactory: arcEnvironment.SimpleFactory,
  hybridDeleGator: required(arcEnvironment.implementations, 'HybridDeleGatorImpl'),
  valueLte: required(arcEnvironment.caveatEnforcers, 'ValueLteEnforcer'),
  erc20PeriodTransfer: required(arcEnvironment.caveatEnforcers, 'ERC20PeriodTransferEnforcer'),
  timestamp: required(arcEnvironment.caveatEnforcers, 'TimestampEnforcer'),
  id: required(arcEnvironment.caveatEnforcers, 'IdEnforcer'),
  exactExecution: required(arcEnvironment.caveatEnforcers, 'ExactExecutionEnforcer'),
  redeemer: required(arcEnvironment.caveatEnforcers, 'RedeemerEnforcer'),
  limitedCalls: required(arcEnvironment.caveatEnforcers, 'LimitedCallsEnforcer'),
} as const
