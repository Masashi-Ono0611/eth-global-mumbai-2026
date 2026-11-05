import { describe, expect, expectTypeOf, test } from 'vitest'

import { direction, format, formatRich, normalizeLocale, text, type MessageValues } from './index.ts'

describe('App locales', () => {
  test('formats the reviewed English and Slovenian catalog', () => {
    expect(text('catalog.pieces', { count: 2 })).toBe('2 pieces')
    expect(format('sl', 'catalog.pieces', { count: 2 })).toBe('2 kosa')
  })

  test("formats Japanese and Hindi, with each language's plural rules", () => {
    expect(format('ja', 'landing.title', {})).toBe('予算を持ったアヒル。')
    expect(format('ja', 'catalog.pieces', { count: 1 })).toBe('1点')
    expect(format('ja', 'catalog.pieces', { count: 3 })).toBe('3点')
    expect(format('hi', 'landing.title', {})).toBe('बजट वाली बत्तख।')
    expect(format('hi', 'catalog.pieces', { count: 1 })).toBe('1 वस्तु')
    expect(format('hi', 'catalog.pieces', { count: 3 })).toBe('3 वस्तुएँ')
    expect(normalizeLocale('ja-JP')).toBe('ja')
    expect(normalizeLocale('hi-IN')).toBe('hi')
    expect(format('mr', 'landing.title', {})).toBe('बजेट असलेले बदक.')
    // Marathi numbers default to Devanagari digits (२), unlike Hindi's Latin ones.
    expect(format('mr', 'catalog.pieces', { count: 2 })).toBe('२ वस्तू')
    expect(normalizeLocale('mr-IN')).toBe('mr')
  })

  test('keeps locale state explicit and supports pseudolocales', () => {
    expect(normalizeLocale('sl-SI')).toBe('sl')
    expect(normalizeLocale('unknown')).toBe('en')
    expect(direction('ar-XB')).toBe('rtl')
    expect(normalizeLocale('sloppy')).toBe('en')
    expect(format('en-XA', 'auth.signInTitle', {})).toContain('⟦')
    const userValue = '<script>customer</script>'
    expect(format('en-XA', 'common.errorDetail', { message: userValue })).toContain(userValue)
    expect(format('ar-XB', 'auth.signInTitle', {})).toContain('\u2067')
  })

  test.each([
    [1, '1 kos'],
    [2, '2 kosa'],
    [3, '3 kosi'],
    [5, '5 kosov'],
    [102, '102 kosa'],
  ])('uses Slovenian plural categories for %s', (count, expected) => {
    expect(format('sl', 'catalog.pieces', { count })).toBe(expected)
  })

  test('interleaves request locales without changing cached formatters', async () => {
    const results = await Promise.all(
      Array.from({ length: 40 }, async (_, index) => {
        const locale = index % 2 === 0 ? 'en' : 'sl'
        await Promise.resolve()
        return format(locale, 'catalog.pieces', { count: 2 })
      }),
    )
    expect(results.every((result, index) => result === (index % 2 === 0 ? '2 pieces' : '2 kosa'))).toBe(true)
  })

  test('rich translations return structured nodes rather than HTML', () => {
    type Node = { tag: 'em'; children: readonly (string | Node)[] }
    const italic = (children: (string | Node)[]): Node => ({ tag: 'em', children })
    expect(formatRich<'landing.lead', Node>('sl', 'landing.lead', { italic })).toEqual([
      'Vaša raca, ',
      { tag: 'em', children: ['vaš proračun'] },
      '.',
    ])
  })

  test('generated contracts require numeric plural counts', () => {
    expectTypeOf<MessageValues<'catalog.pieces'>>().toEqualTypeOf<{ readonly count: number }>()
    expectTypeOf<{ count: string }>().not.toExtend<MessageValues<'catalog.pieces'>>()
    expectTypeOf<{}>().not.toExtend<MessageValues<'catalog.pieces'>>()
  })
})
