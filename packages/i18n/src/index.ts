import { IntlMessageFormat } from 'intl-messageformat'

import { en, sl } from './catalogs.ts'
import type { MessageKey, MessageValues } from './generated.ts'
import { pseudoMessage } from './pseudo.ts'

export type { MessageKey, MessageValues, RichTextValue } from './generated.ts'
export { catalogVersion } from './generated.ts'
export type Locale = 'en' | 'sl' | 'en-XA' | 'ar-XB'

const defaultLocale: Locale = 'en'
const formatterLimit = 4096
const formatters = new Map<string, IntlMessageFormat>()

const baseLocale = (locale: Locale): 'en' | 'sl' => (locale === 'sl' ? 'sl' : 'en')

const formatterFor = (locale: Locale, key: MessageKey): IntlMessageFormat => {
  const cacheKey = `${locale}:${key}`
  const cached = formatters.get(cacheKey)
  if (cached !== undefined) return cached
  const catalog = baseLocale(locale) === 'sl' ? sl : en
  const source = new IntlMessageFormat(catalog[key], baseLocale(locale))
  const formatter =
    locale === 'en-XA' || locale === 'ar-XB'
      ? new IntlMessageFormat(pseudoMessage(source.getAst(), locale), 'en')
      : source
  if (formatters.size >= formatterLimit) {
    const oldest = formatters.keys().next().value
    if (oldest !== undefined) formatters.delete(oldest)
  }
  formatters.set(cacheKey, formatter)
  return formatter
}

export const normalizeLocale = (input: string | undefined): Locale => {
  if (input === 'en-XA' || input === 'ar-XB') return input
  if (/^sl(?:-[a-z0-9]{2,8})*$/i.test(input ?? '')) return 'sl'
  return defaultLocale
}

export const direction = (locale: Locale): 'ltr' | 'rtl' => (locale === 'ar-XB' ? 'rtl' : 'ltr')

export const formatRich = <K extends MessageKey, T = string>(
  locale: Locale,
  key: K,
  values: MessageValues<K, T>,
): string | T | (string | T)[] => {
  const rendered = formatterFor(locale, key).format<T>(values)
  return rendered
}

export const format = <K extends MessageKey>(locale: Locale, key: K, values: MessageValues<K>): string => {
  const rendered = formatRich(locale, key, values)
  return typeof rendered === 'string' ? rendered : rendered.join('')
}

export const text = <K extends MessageKey>(key: K, values: MessageValues<K>): string => {
  return format(defaultLocale, key, values)
}
