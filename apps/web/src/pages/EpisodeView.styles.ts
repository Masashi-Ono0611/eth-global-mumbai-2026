import { style } from '../zyzz.config.ts'

/** One errand after the fact: the summary, the timeline, then one card per party. */
export const auditLayout = style({
  display: 'grid',
  gap: '0.75rem',
  paddingBlockEnd: '3rem',
})

export const auditCard = style({
  display: 'grid',
  justifyItems: 'start',
  gap: '0.75rem',
  paddingBlock: '1.5rem',
  borderBlockStartWidth: '1px',
  borderBlockStartStyle: 'solid',
  borderBlockStartColor: 'rule',
  overflowWrap: 'anywhere',
  '& > *': { maxInlineSize: '100%' },
})

/** Label and value pairs; values are ids, hashes and amounts, so they are monospaced and may break anywhere. */
export const fieldList = style({
  display: 'grid',
  gridTemplateColumns: 'max-content minmax(0, 1fr)',
  columnGap: '1rem',
  rowGap: '0.35rem',
  margin: '0',
  inlineSize: '100%',
  '& dt': { fontSize: 'small', color: 'muted' },
  '& dd': { margin: '0', fontFamily: 'mono', fontSize: 'small', overflowWrap: 'anywhere' },
  '@media (max-width: 560px)': {
    gridTemplateColumns: 'minmax(0, 1fr)',
    '& dd': { marginBlockEnd: '0.5rem' },
  },
})

/** The exact JSON the brain received, folded away until asked for. */
export const inputDetails = style({
  inlineSize: '100%',
  '& summary': { cursor: 'pointer', minBlockSize: '44px', paddingBlock: '0.6rem' },
  '& pre': {
    margin: '0',
    paddingBlock: '0.75rem',
    paddingInline: '1rem',
    fontFamily: 'mono',
    fontSize: 'small',
    overflow: 'auto',
    maxBlockSize: '24rem',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rule',
    borderRadius: 'control',
  },
})

export const timelineList = style({
  display: 'grid',
  gap: '0.5rem',
  margin: '0',
  paddingInlineStart: '1rem',
  listStyle: 'none',
  borderInlineStartWidth: '2px',
  borderInlineStartStyle: 'solid',
  borderInlineStartColor: 'rule',
  overflowWrap: 'anywhere',
  '& time': {
    fontFamily: 'mono',
    fontSize: 'small',
    color: 'muted',
    fontVariantNumeric: 'tabular-nums',
    marginInlineEnd: '0.75rem',
  },
})

/** A column of related lines (one decision, one verify answer). */
export const stack = style({ display: 'grid', justifyItems: 'start', gap: '0.5rem', inlineSize: '100%' })

/** A replay's answer, set off from the original decision above it. */
export const replayBox = style({
  display: 'grid',
  gap: '0.5rem',
  inlineSize: '100%',
  paddingInlineStart: '1rem',
  borderInlineStartWidth: '3px',
  borderInlineStartStyle: 'solid',
  borderInlineStartColor: 'ink',
})

/** Verify's checks: each says whether the stored value matches the EpisodeLog record. */
export const checkList = style({
  display: 'grid',
  gap: '0.35rem',
  margin: '0',
  padding: '0',
  listStyle: 'none',
  '& [data-match="yes"]': { color: 'online' },
  '& [data-match="yes"]::before': { content: '"✓ "' },
  '& [data-match="no"]': { color: 'error' },
  '& [data-match="no"]::before': { content: '"✗ "' },
})

export const alertText = style({ color: 'error' })

export const actionRow = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.75rem',
})

/** Verify and Replay: the app's secondary action as a real button (no UA fill), dimmed while its request runs. */
export const auditButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  minBlockSize: '48px',
  paddingBlock: '0.65rem',
  paddingInline: '1.5rem',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'rule',
  borderRadius: 'control',
  backgroundColor: 'transparent !custom',
  color: 'ink',
  cursor: 'pointer',
  '&:active': { opacity: 0.8 },
  '&:disabled': { opacity: 0.55, cursor: 'progress' },
  '@media (hover: hover) and (pointer: fine)': { '&:hover:not(:disabled)': { borderColor: 'ink' } },
})
