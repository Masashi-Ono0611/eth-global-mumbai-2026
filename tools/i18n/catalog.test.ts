import { describe, expect, test } from 'vitest'
import { contractFor, flatten, validateCatalogs } from './catalog.ts'

describe('catalog acceptance', () => {
  test('rejects missing keys, malformed ICU, empty text and variable drift', () => {
    expect(() => validateCatalogs({ hello: 'Hi' }, { sl: {} })).toThrow('key parity')
    expect(() => contractFor('en', 'bad', '{count, plural')).toThrow()
    expect(() => flatten({ empty: '' })).toThrow('Empty message')
    expect(() => flatten({ number: 1 })).toThrow('Invalid catalog node')
    expect(() => validateCatalogs({ hello: 'Hi {name}' }, { sl: { hello: 'Živjo {user}' } })).toThrow('Argument parity')
  })

  test('requires Slovenian dual/few and allows only approved rich tags', () => {
    expect(() => contractFor('sl', 'new', '{n, plural, one {kos} other {kosi}}')).toThrow('Missing plural')
    expect(() => contractFor('en', 'unsafe', '<script>hello</script>')).toThrow('Unapproved rich tag')
    expect(() => contractFor('hi', 'new', '{n, plural, other {वस्तुएँ}}')).toThrow('Missing plural')
    expect(contractFor('ja', 'new', '{n, plural, other {#点}}').get('n')).toBe('number')
    expect(() => validateCatalogs({ text: '<italic>Hello</italic>' }, { sl: { text: 'Živjo' } })).toThrow(
      'Argument parity',
    )
  })

  test('uses the strictest numeric contract when translations omit plural syntax', () => {
    const contracts = validateCatalogs({ count: '{n, plural, one {#} other {#}}' }, { sl: { count: '{n}' } })
    expect(contracts.get('count')?.get('n')).toBe('number')
  })
})
