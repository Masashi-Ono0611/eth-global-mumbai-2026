---
name: styling
description: Style Vitaquack's Foldkit views the way Foldkit does — Tailwind v4 utilities through h.Class, design tokens in styles.css @theme, @foldkit/ui for interactive widgets, clsx for conditional classes. Use before adding or changing any visual styling or interactive widget in apps/web.
---

# Styling in Vitaquack

We follow Foldkit's own setup (`create-foldkit-app`, `repos/foldkit/examples/ssr`, `repos/foldkit/examples/ui-showcase`) rather than inventing one. Load the `foldkit` skill for the architecture; this skill covers only how things look.

## Where things live

- `apps/web/vite.config.ts`: `tailwindcss()` before `foldkit(...)`, as in Foldkit's examples.
- `apps/web/src/styles.css`, imported once by `entry.ts`:
  - `@import 'tailwindcss'`, then `@theme` with the design tokens. Every token is a utility (`--color-muted` → `text-muted`, `border-muted`; `--font-display` → `font-display`; `--radius-control` → `rounded-control`) and a CSS variable (`var(--color-ink)`). Add a token before using a new colour, font or radius; never hard-code one in a view.
  - `@layer base`: document defaults on top of Tailwind's preflight (headings, links, controls, focus ring, the ja/hi/mr script faces).
  - `@layer components`: the foundation's class rules (`.site`, `.primary-action`, `.auth-form`, …), kept so unrestyled pages render as before. They are in a lower layer than utilities, so utilities on the same element win. When a view is restyled, its classes move into the view and the rule is deleted here.
- Views: Tailwind class strings as named constants at the top of the view module under `// STYLES` (`const auditCardClassName = 'grid gap-3 border-t border-rule py-6'`), applied with `h.Class(auditCardClassName)`. `pages/EpisodeView.ts` and `pages/Episodes.ts` are the worked examples.

## Rules

- Conditional classes use `clsx` (Foldkit's convention): `h.Class(clsx('base', { 'text-error': failed }))`. Never string concatenation, template literals or `&&`. Add `clsx` to `apps/web` with its first use (Knip rejects an unused dependency).
- Interactive widgets come from `@foldkit/ui` (pinned to our Foldkit version): Dialog, Menu, Tabs, Disclosure, Popover, Tooltip, Switch, Checkbox, RadioGroup, Select, Listbox, Combobox, Toast, … before hand-rolling one. They are Submodels with accessible behaviour built in and no styling: style them with utilities and their state attributes (`data-[closed]:opacity-0`, `data-[selected]:bg-ink`, `data-[disabled]:opacity-50`). Read `repos/foldkit/examples/ui-showcase/src/ui/view/<component>.ts` for the wiring and classes, and `generate-program`'s component table for what each one gives. `knip.config.ts` ignores `@foldkit/ui` until the first import; remove that ignore when you add it.
- Child and state selectors are arbitrary variants (`[&_td]:py-2`, `[&_[data-match=yes]]:text-online`); breakpoints are mobile-first (`sm:`, or `max-[560px]:` to mirror an existing max-width rule). `hover:` already applies only on devices that hover.
- Tailwind's preflight removes browser defaults: a bare `button` has no border or fill, lists have no bullets, headings have no size except what `@layer base` gives them. Style a raw `input` or `textarea` explicitly (background, border).
- Keep every control at least 44px tall (`min-h-11`); the focus ring comes from `@layer base`.
- No inline `style` attributes for design; model state with classes or data attributes.
- Tests locate elements by role, text or landmark, never by class names.
- Tailwind scans `apps/web/src` automatically; a class built from string pieces (`'text-' + tone`) is never generated, so write whole class names.

## Reference

Tailwind v4 docs: `https://tailwindcss.com/docs` (theme variables, adding custom styles, hover/focus and other states). Foldkit UI: `https://foldkit.dev` and the vendored `repos/foldkit/packages/ui/src`. The design skills (`frontend-design`, `make-interfaces-feel-better`, `good-css`, `mobile-native`, `break-ui`) apply on top of this.
