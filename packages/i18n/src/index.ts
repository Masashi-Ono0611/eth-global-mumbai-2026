import { IntlMessageFormat } from 'intl-messageformat'

import { en } from './catalogs.ts'
import type { MessageKey, MessageValues } from './generated.ts'

export type { MessageKey, MessageValues, RichTextValue } from './generated.ts'
export { catalogVersion } from './generated.ts'
/** The app is English only (Kris, 6 Nov 2026); the locale stays explicit so rendering and Intl remain deterministic. */
export type Locale = 'en'

const defaultLocale: Locale = 'en'
const formatters = new Map<MessageKey, IntlMessageFormat>()

const formatterFor = (key: MessageKey): IntlMessageFormat => {
  const cached = formatters.get(key)
  if (cached !== undefined) return cached
  const formatter = new IntlMessageFormat(en[key], defaultLocale)
  formatters.set(key, formatter)
  return formatter
}

export const formatRich = <K extends MessageKey, T = string>(
  _locale: Locale,
  key: K,
  values: MessageValues<K, T>,
): string | T | (string | T)[] => formatterFor(key).format<T>(values)

export const format = <K extends MessageKey>(locale: Locale, key: K, values: MessageValues<K>): string => {
  const rendered = formatRich(locale, key, values)
  return typeof rendered === 'string' ? rendered : rendered.join('')
}

export const text = <K extends MessageKey>(key: K, values: MessageValues<K>): string =>
  format(defaultLocale, key, values)
