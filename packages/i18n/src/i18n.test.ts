import { describe, expect, expectTypeOf, test } from 'vitest'

import { format, formatRich, text, type MessageValues } from './index.ts'

describe('App copy', () => {
  test('formats the reviewed English catalog with plurals', () => {
    expect(text('catalog.pieces', { count: 1 })).toBe('1 piece')
    expect(text('catalog.pieces', { count: 2 })).toBe('2 pieces')
    expect(format('en', 'catalog.pieces', { count: 2 })).toBe('2 pieces')
  })

  test('rich messages return structured nodes rather than HTML', () => {
    type Node = { tag: 'em'; children: readonly (string | Node)[] }
    const italic = (children: (string | Node)[]): Node => ({ tag: 'em', children })
    const rendered = formatRich<'landing.lead', Node>('en', 'landing.lead', { italic })
    expect(Array.isArray(rendered)).toBe(true)
    expect(JSON.stringify(rendered)).not.toContain('<')
  })

  test('generated contracts require numeric plural counts', () => {
    expectTypeOf<MessageValues<'catalog.pieces'>>().toEqualTypeOf<{ readonly count: number }>()
    expectTypeOf<{ count: string }>().not.toExtend<MessageValues<'catalog.pieces'>>()
    expectTypeOf<{}>().not.toExtend<MessageValues<'catalog.pieces'>>()
  })
})
