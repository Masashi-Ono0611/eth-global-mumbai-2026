import { global } from 'zyzz/web'
import { vars } from './zyzz.config.ts'

// Document defaults. The zyzz Vite plugin discovers this module; nothing imports it. Component styles live in a
// sibling `<View>.styles.ts`; the class rules still in styles.css move there as views are restyled.
global({
  ':root': {
    colorScheme: 'light',
    fontFamily: vars.fontFamily.body,
    backgroundColor: vars.color.paper,
    color: vars.color.ink,
    lineHeight: 1.55,
    fontSynthesis: 'none',
  },
  '*': { boxSizing: 'border-box' },
  html: {
    WebkitTextSizeAdjust: '100%',
    WebkitTapHighlightColor: 'transparent',
    scrollbarGutter: 'stable',
  },
  body: { margin: 0 },
  'h1, h2, p': { margin: 0 },
  'h1, h2': {
    fontFamily: vars.fontFamily.display,
    fontWeight: 300,
    lineHeight: 1.12,
    textWrap: 'balance',
  },
  h1: { fontSize: vars.fontSize.display, letterSpacing: '-0.022em', maxInlineSize: '15ch' },
  h2: { fontSize: vars.fontSize.heading },
  p: { maxInlineSize: '65ch', textWrap: 'pretty' },
  a: { color: 'inherit', textUnderlineOffset: '0.2em', touchAction: 'manipulation' },
  'button, select': {
    font: 'inherit',
    fontSize: vars.fontSize.body,
    minBlockSize: '44px',
    touchAction: 'manipulation',
  },
  select: {
    backgroundColor: 'transparent',
    color: 'inherit',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: vars.color.muted,
    borderRadius: vars.radius.control,
    maxInlineSize: '100%',
    padding: '0.45rem',
  },
  ':focus-visible': {
    outlineWidth: '2px',
    outlineStyle: 'solid',
    outlineColor: vars.color.focus,
    outlineOffset: '4px',
  },
  '@media (hover: hover) and (pointer: fine)': {
    'a:hover': { textDecorationThickness: '2px' },
  },
  ':lang(ja)': { fontFamily: vars.fontFamily.japanese },
  ':lang(hi), :lang(mr)': { fontFamily: vars.fontFamily.devanagari },
  ':lang(ja) :is(h1, h2), :lang(hi) :is(h1, h2), :lang(mr) :is(h1, h2)': { fontFamily: 'inherit' },
})
