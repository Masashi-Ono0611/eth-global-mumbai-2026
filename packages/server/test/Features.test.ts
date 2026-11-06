import { expect, test } from 'vitest'
import { features } from '../src/Features.ts'

const configured = {
  ARC_RPC_URL: 'https://arc-rpc.publicnode.com',
  RELAYER_PRIVATE_KEY: `0x${'a'.repeat(64)}`,
  APPROVER_PRIVATE_KEY: `0x${'b'.repeat(64)}`,
  ENFORCER_ADDRESS: '0x7c2167B0a49108b28DFDA3aca5ddddd9Af68e4D3',
  ZG_BASE_URL: 'https://router.example/v1',
  ZG_API_KEY: 'zg-key-0123456789',
  ZG_MODEL: 'model',
  WORLD_CLIENT_ID: 'app_123',
  WORLD_CLIENT_SECRET: 'secret',
  WORLD_ISSUER: 'https://auth.world.org',
  MERCHANT_PAY_TO: '0x2845D56f584c5f38d1f0f4B3C1A0A28cf55397F5',
  RESTRICTED_PAY_TO: '0x0166cD2A4E81F381CA005A791e151ee7D3F88f52',
  GATE_ED25519_SEED: 'c'.repeat(64),
  EVIDENCE_TOKEN: 'evidence-token-0123456789',
}

test('every feature is true when its bindings are well-formed, and the report carries booleans only', () => {
  const report = features(configured)
  expect(Object.values(report).every(Boolean)).toBe(true)
  expect(JSON.stringify(report)).not.toContain('0x')
})

test('a `pending` placeholder, a missing or a malformed binding turns only its own feature off', () => {
  expect(features({ ...configured, ZG_API_KEY: 'pending' })).toMatchObject({ zg: false, relayer: true })
  expect(features({ ...configured, RELAYER_PRIVATE_KEY: '0x1234' })).toMatchObject({ relayer: false, zg: true })
  const { WORLD_ISSUER: _issuer, ...noIssuer } = configured
  expect(features(noIssuer)).toMatchObject({ world: false, gate: true })
  expect(features({})).toEqual({
    arc: false,
    relayer: false,
    approver: false,
    enforcer: false,
    zg: false,
    world: false,
    merchant: false,
    gate: false,
    evidence: false,
  })
})
