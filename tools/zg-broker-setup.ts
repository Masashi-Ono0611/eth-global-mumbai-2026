import { readFile, rename, writeFile } from 'node:fs/promises'
import { createZGComputeNetworkBroker } from '@0gfoundation/0g-compute-ts-sdk'
import { formatEther, JsonRpcProvider, parseEther, Wallet } from 'ethers'

// One-time setup of the 0G Compute direct path (fallback for a missing router key): a ledger funded with 3 0G, a 1 0G
// sub-account at one provider (acknowledged), and a persistent provider API key. The Worker then calls the provider's
// OpenAI-compatible endpoint itself with APP_ZG_BASE_URL / APP_ZG_API_KEY / APP_ZG_MODEL, written here into
// .env.main.local (mode 600) and never printed.
//
//   bun tools/zg-broker-setup.ts                      # read-only: balance, ledger, sub-account, provider, the plan
//   bun tools/zg-broker-setup.ts --execute            # sends the ledger/sub-account transactions still missing
//   bun tools/zg-broker-setup.ts --execute --write    # …and mints the API key and replaces APP_ZG_* in the env file
//   options: --provider 0x… (default: the live qwen service), --env-file .env.main.local, --new-key, --rpc URL
//
// Re-runs are idempotent: an existing ledger and sub-account are reused, and an API key already in the env file for
// this provider is kept unless --new-key. APP_ZG_* (e.g. the rehearsal brain) are only replaced with --write.

const DEFAULT_PROVIDER = '0xd6269e257761705B9e442E59794703762DFcC940' // qwen/qwen3.8-omni-flash on Galileo, TEE-acknowledged
const LEDGER_0G = 3
const SUB_ACCOUNT_0G = 1
const GAS_RESERVE_0G = 0.1

const flag = (name: string) => {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}
const has = (name: string) => process.argv.includes(`--${name}`)
const envFile = flag('env-file') ?? '.env.main.local'
const provider = flag('provider') ?? DEFAULT_PROVIDER
const rpc = flag('rpc') ?? 'https://evmrpc-testnet.0g.ai'
const execute = has('execute')
const write = has('write')

const stop = (message: string): never => {
  console.error(message)
  process.exit(1)
}

const envText = await readFile(envFile, 'utf8').catch(() => '')
const envValue = (name: string) => {
  const line = envText.split('\n').find((candidate) => candidate.startsWith(`${name}=`))
  const value = line
    ?.slice(name.length + 1)
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
  return value === undefined || value === '' || value === 'pending' ? undefined : value
}

/** Replace or append KEY=value lines; the file stays mode 600 (written beside it, then renamed over it). */
const writeEnv = async (values: Readonly<Record<string, string>>) => {
  const lines = envText.split('\n')
  const remaining = new Map(Object.entries(values))
  const updated = lines.map((line) => {
    const key = /^([A-Z0-9_]+)=/.exec(line)?.[1]
    const value = key === undefined ? undefined : remaining.get(key)
    if (key === undefined || value === undefined) return line
    remaining.delete(key)
    return `${key}=${value}`
  })
  const body =
    updated.join('\n').replace(/\n*$/, '\n') + [...remaining].map(([key, value]) => `${key}=${value}\n`).join('')
  await writeFile(`${envFile}.tmp`, body, { mode: 0o600 })
  await rename(`${envFile}.tmp`, envFile)
}

const key = envValue('APP_ZG_STORAGE_PRIVATE_KEY') ?? stop(`not configured: APP_ZG_STORAGE_PRIVATE_KEY in ${envFile}`)
if (!/^0x[0-9a-fA-F]{64}$/.test(key)) stop('APP_ZG_STORAGE_PRIVATE_KEY is not a 32-byte hex key')
if (!/^0x[0-9a-fA-F]{40}$/.test(provider)) stop(`--provider ${provider} is not an address`)

const chain = new JsonRpcProvider(rpc)
const wallet = new Wallet(key, chain)
const network = await chain.getNetwork()
if (network.chainId !== 16602n) stop(`${rpc} is chain ${network.chainId}, not 0G Galileo (16602)`)
const broker = await createZGComputeNetworkBroker(wallet)

const balance0g = async () => Number(formatEther(await chain.getBalance(wallet.address)))
const ledgerExists = await broker.ledger.getLedger().then(
  () => true,
  () => false,
)
const account = await broker.inference.getAccount(provider).then(
  (found) => found,
  () => undefined,
)
const { endpoint, model } = await broker.inference.getServiceMetadata(provider)
const keptKey =
  envValue('APP_ZG_API_KEY')?.startsWith('app-sk-') && envValue('APP_ZG_BASE_URL') === endpoint && !has('new-key')
const subAccountLow = account !== undefined && account.balance < parseEther('0.05')
const needed =
  (ledgerExists ? 0 : LEDGER_0G) + (account === undefined || subAccountLow ? SUB_ACCOUNT_0G : 0) + GAS_RESERVE_0G
const before = await balance0g()

console.log(`wallet      ${wallet.address}`)
console.log(`balance     ${before} 0G (needs ${needed} 0G for what is missing)`)
console.log(`provider    ${provider}`)
console.log(`model       ${model}`)
console.log(`ledger      ${ledgerExists ? 'exists' : `missing → addLedger(${LEDGER_0G})`}`)
console.log(
  `sub-account ${account === undefined ? `missing → ${SUB_ACCOUNT_0G} 0G + acknowledge` : `${formatEther(account.balance)} 0G, acknowledged ${account.acknowledged}`}`,
)
console.log(`api key     ${keptKey ? 'kept (already in the env file)' : 'missing → createApiKey(expiresIn 0)'}`)
if (!execute) {
  if (!keptKey)
    console.log(
      `would set   APP_ZG_BASE_URL=${endpoint} APP_ZG_MODEL=${model} and a new APP_ZG_API_KEY (--execute --write)`,
    )
  console.log('read-only run: nothing sent (add --execute)')
  process.exit(0)
}
if (before < needed)
  stop(`refused: ${before} 0G is below the ${needed} 0G this setup needs; fund ${wallet.address} first`)

if (!ledgerExists) await broker.ledger.addLedger(LEDGER_0G)
// Creates the sub-account with the contract's 1 0G minimum when it is missing, then acknowledges the TEE signer.
if (account === undefined || !account.acknowledged) await broker.inference.acknowledgeProviderSigner(provider)
if (subAccountLow) await broker.ledger.transferFund(provider, 'inference', parseEther(String(SUB_ACCOUNT_0G)))
if (keptKey) console.log('api key     kept')
else if (!write)
  console.log(`would set   APP_ZG_BASE_URL=${endpoint} APP_ZG_MODEL=${model} and a new APP_ZG_API_KEY (add --write)`)
else {
  const created = await broker.inference.requestProcessor.createApiKey(provider, { expiresIn: 0 })
  await writeEnv({ APP_ZG_BASE_URL: endpoint, APP_ZG_API_KEY: created.rawToken, APP_ZG_MODEL: model })
  console.log(`wrote APP_ZG_BASE_URL, APP_ZG_API_KEY (token ${created.tokenId}), APP_ZG_MODEL to ${envFile}`)
}
console.log(`balance     ${await balance0g()} 0G after`)
console.log('next: bun packages/server/scripts/zg-probe.ts, then set the three values on the deployed Worker')
