import { expect, test } from 'vitest'
import { statusAt } from '../src/robot/Budget.ts'

const now = 1_800_000_000

test('an active grant past its window reads expired (Arc refuses it), and every other status is kept', () => {
  expect(statusAt({ status: 'active', expires_at: now + 60 }, now)).toBe('active')
  // The window's last second has passed: the owner sees it ended, not "3.00 of 3.00 today".
  expect(statusAt({ status: 'active', expires_at: now }, now)).toBe('expired')
  expect(statusAt({ status: 'active', expires_at: now - 3600 }, now)).toBe('expired')
  // A stop in flight or done stays what it is, even past the window.
  expect(statusAt({ status: 'revoking', expires_at: now - 3600 }, now)).toBe('revoking')
  expect(statusAt({ status: 'revoked', expires_at: now - 3600 }, now)).toBe('revoked')
})
