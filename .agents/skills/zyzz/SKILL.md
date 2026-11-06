---
name: zyzz
description: Style Vitaquack's Foldkit views with zyzz — tokens, typed styles, global rules and the Foldkit adapter. Use before adding or changing any visual styling in apps/web, or when a zyzz type, lint or build error appears.
---

# zyzz in Vitaquack

Styling is moving to zyzz (`zyzz/vite` in `apps/web/vite.config.ts`, pinned in the root catalog). Adapted from Styld v2's local skill; zyzz has no Foldkit adapter, so `Styled.ts` is ours.

## Where things live

- `apps/web/src/zyzz.config.ts` holds the tokens (`color`, `fontFamily`, `fontSize`, `radius`) and the bound `style` helper with `output: 'html'`. New literal colours and font families go there as tokens first.
- `apps/web/src/GlobalStyles.ts` holds document defaults through `global` from `zyzz/web`. The Vite plugin discovers it; nothing imports it (Knip has it as an entry).
- Component styles live in a sibling `<View>.styles.ts` (for example `pages/RobotsView.styles.ts` beside `pages/RobotsView.ts`) as exported module-level `const name = style({...})` calls. Keeping CSS values out of view modules keeps views readable as copy.
- `apps/web/src/Styled.ts` turns an applied style into Foldkit attributes: `h.code(styled(h, pairingCode()), …)` or `[h.Id('x'), ...styled(h, card())]`. Combine styles with `cx(a(), b())` from `zyzz`; later arguments win.

## Transitional state

`apps/web/src/styles.css` still holds the foundation's class rules (`.site`, `.primary-action`, `.auth-form`, …) and four `:root` custom properties that repeat the colour tokens. A restyled view moves its rules into a `.styles.ts` file and deletes them from `styles.css`; when the file is empty, delete it and its import in `entry.ts`.

## Rules

- Use token names for token-mapped properties (`color: 'muted'`, `borderColor: 'rule'`, `borderRadius: 'control'`). Write borders and outlines as longhands so the colour takes a token. Do not interpolate `vars.*` into template strings.
- `!custom` marks a deliberate literal on a token-constrained property, such as `'transparent !custom'`. Keep it rare.
- Pass `style()` a literal object at module scope. Spreading imported records into a definition is outside zyzz's verified compiler scope.
- Prefer static styles; model state with variants or `data-*` selectors rather than inline `style` declarations.
- Write a type-only import as `import type { … }`, not `import { type A, type B }`: zyzz's compiler tries to resolve an all-inline-type import and fails the build with `Missing host resolution`.
- Tests locate elements by role, text or landmark, never by generated class names.
- `bun run typecheck` rejects unknown properties, token names and value types; `bun run unused:production` reports unused styles; `bun run lint` runs `zyzz/valid-styles`. zyzz's JSX and namespace rules cannot apply to Foldkit views.
- The CSS baseline is Chrome/Edge 123, Firefox 120 and Safari 17.5 (`build.cssTarget`); zyzz emits native nesting that older browsers drop.

## Reference

Read the docs before using an unfamiliar zyzz API: `https://zyzz.style/llms.txt` lists every page; each page has a Markdown URL ending in `.md`. The installed source is under `apps/web/node_modules/zyzz/src`, and `references/wevm_zyzz` is the upstream clone. Styld v2 (`~/code/styldappv2/apps/web/src`, `zyzz.config.ts`, `GlobalStyles.ts`, `*.styles.ts`) is a full worked example. The relevant pages are Styling, Themes & Tokens, Conditions, Global Styles, `defineConfig`, `cx`, Runtime › Html and Integrations › Vite.
