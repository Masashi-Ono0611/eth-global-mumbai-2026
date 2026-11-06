import { defineConfig } from 'zyzz'

/** Design tokens: the only place a literal colour, font family or radius may appear. Styles compile to `class`/`style`
 * attributes that `Styled.ts` hands to Foldkit. The values are the palette inherited from the styldappv2 foundation
 * (light only); the product redesign replaces them here. */
export const { style, vars } = defineConfig({
  id: 'vq',
  output: 'html',
  vars: {
    color: {
      paper: 'oklch(94.5% 0.01 76)',
      ink: 'oklch(19% 0.024 52)',
      // Secondary text, hints and empty states.
      muted: 'oklch(47% 0.014 60)',
      // Hairlines and field edges.
      rule: 'oklch(81% 0.011 70)',
      // The keyboard focus ring.
      focus: 'oklch(50% 0.095 248)',
      // Error text, and an invalid field's edge.
      error: 'oklch(48% 0.16 25)',
      invalid: 'oklch(58% 0.16 25)',
      online: 'oklch(45% 0.12 150)',
    },
    fontFamily: {
      body: "'Hanken Grotesk', system-ui, sans-serif",
      display: "'Sentient', Georgia, serif",
      mono: "ui-monospace, 'SF Mono', Menlo, monospace",
      // The Latin faces above have no CJK or Devanagari glyphs, so these scripts prefer their system face.
      japanese: "'Hiragino Sans', 'Yu Gothic', 'Noto Sans JP', system-ui, sans-serif",
      devanagari: "'Noto Sans Devanagari', 'Kohinoor Devanagari', 'Nirmala UI', system-ui, sans-serif",
    },
    fontSize: {
      display: 'clamp(2.5rem, 1.5rem + 4vw, 5rem)',
      heading: '2rem',
      code: '2rem',
      body: '1rem',
    },
    radius: { control: '3px' },
  },
})
