import { Schema } from 'effect'

export const Locale = Schema.Literals(['en', 'sl', 'ja', 'hi', 'mr', 'en-XA', 'ar-XB'])
export type Locale = typeof Locale.Type
export const localeEndpoint = '/locale'

export const parseLocale = (value: string | null | undefined): Locale | undefined =>
  Schema.is(Locale)(value) ? value : undefined

const languageRange = (range: string): Locale | undefined => {
  const language = range.trim().toLowerCase().split('-')[0]
  return (['en', 'sl', 'ja', 'hi', 'mr'] as const).find((candidate) => candidate === language)
}

/** Request-local negotiation. Invalid cookies and q=0 ranges never select a language. */
export const requestLocale = (request: Request): Locale => {
  const url = new URL(request.url)
  const explicit = parseLocale(url.searchParams.get('lang'))
  if (explicit !== undefined) return explicit
  const cookie = request.headers
    .get('cookie')
    ?.split(';')
    .find((part) => part.trim().startsWith('app_locale='))
  const saved = parseLocale(cookie?.trim().slice('app_locale='.length))
  if (saved !== undefined) return saved
  const ranges = (request.headers.get('accept-language') ?? '')
    .slice(0, 4096)
    .split(',')
    .map((part) => {
      const [tag = '', ...parameters] = part.split(';')
      const weight = parameters
        .find((item) => item.trim().startsWith('q='))
        ?.trim()
        .slice(2)
      const quality = weight === undefined ? 1 : Number(weight)
      return { locale: languageRange(tag), quality }
    })
    .filter(({ locale, quality }) => locale !== undefined && quality > 0 && quality <= 1)
  ranges.sort((left, right) => right.quality - left.quality)
  return ranges[0]?.locale ?? 'en'
}

export const localeCookie = (locale: Locale, url: URL): string =>
  'app_locale=' +
  locale +
  '; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax' +
  (url.protocol === 'https:' ? '; Secure' : '')
