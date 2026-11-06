import { style } from '../zyzz.config.ts'

/** The robot filter above the errand table. */
export const filterRow = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '0.6rem',
  marginBlock: '1.5rem',
})

/** The table scrolls sideways on a phone instead of squeezing its columns. */
export const tableScroll = style({
  overflowX: 'auto',
  marginBlockEnd: '2rem',
})

export const episodeTable = style({
  borderCollapse: 'collapse',
  inlineSize: '100%',
  '& th': {
    textAlign: 'start',
    fontWeight: 600,
    fontSize: 'small',
    color: 'muted',
    whiteSpace: 'nowrap',
    paddingBlock: '0.5rem',
    paddingInline: '0.75rem 0',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: 'ink',
  },
  '& td': {
    verticalAlign: 'top',
    paddingBlock: '0.65rem',
    paddingInline: '0.75rem 0',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: 'rule',
  },
  '& :is(th, td):first-child': { paddingInlineStart: '0' },
  '& td:first-child': {
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
    fontSize: 'small',
    color: 'muted',
  },
})
