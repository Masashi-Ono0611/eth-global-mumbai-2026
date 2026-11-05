import { IntlMessageFormat } from 'intl-messageformat'

import { en, hi, ja, sl } from './catalogs.ts'
import type { MessageKey, MessageValues } from './generated.ts'
import { pseudoMessage } from './pseudo.ts'

export type { MessageKey, MessageValues, RichTextValue } from './generated.ts'
export { catalogVersion } from './generated.ts'
/** Translated languages; the pseudo-locales en-XA and ar-XB exercise layout with English text. */
export type Language = 'en' | 'sl' | 'ja' | 'hi'
export type Locale = Language | 'en-XA' | 'ar-XB'
const catalogs: Readonly<Record<Language, Readonly<Record<MessageKey, string>>>> = { en, sl, ja, hi }
const languages: ReadonlyArray<Language> = ['en', 'sl', 'ja', 'hi']

const defaultLocale: Locale = 'en'
const formatterLimit = 4096
const formatters = new Map<string, IntlMessageFormat>()

const baseLocale = (locale: Locale): Language => (locale === 'en-XA' || locale === 'ar-XB' ? 'en' : locale)

const formatterFor = (locale: Locale, key: MessageKey): IntlMessageFormat => {
  const cacheKey = `${locale}:${key}`
  const cached = formatters.get(cacheKey)
  if (cached !== undefined) return cached
  const catalog = catalogs[baseLocale(locale)]
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
  const language = languages.find((candidate) => new RegExp(`^${candidate}(?:-[a-z0-9]{2,8})*$`, 'i').test(input ?? ''))
  if (language !== undefined) return language
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
