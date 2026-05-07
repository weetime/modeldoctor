# Multi-palette theme system

**Status:** Draft
**Author:** weetime + Claude
**Date:** 2026-05-07

## Background

The web app currently ships a single visual identity — shadcn defaults: cool neutral grays for both `:root` (light) and `.dark`. The look is generic and does not project the data-platform / observability character of ModelDoctor. The theme store (`apps/web/src/stores/theme-store.ts`) only models one dimension: `light | dark | system`.

We want to add a second, independent dimension — **palette** — so users can pick from several first-class visual identities, each with both light and dark modes. The default stays equivalent to today, so existing users are not surprised; opt-in palettes let the product feel genuinely premium and on-brand.

## Goals

1. Five palettes available out of the box, each with light + dark variants:
   - **Slate** — the current shadcn neutral. Default for all users (zero visual change on upgrade).
   - **Aurora** — Vercel / Linear style: pure mono base with electric violet accent.
   - **Indigo** — Stripe Dashboard style: ivory + Stripe indigo, deep navy dark.
   - **Plum** — Datadog / Grafana style: dark-first violet, multi-color chart palette tuned for dashboards.
   - **Clay** — Anthropic Console style: cream + caramel/terracotta, editorial feel.

2. Palette and mode (light/dark) switch independently. Choosing Aurora keeps the user's current light/dark preference; toggling dark does not change palette.
3. Charts (ECharts) follow the active palette automatically.
4. One persistence key, no breaking change for users who already have `md.theme.v1` in localStorage.
5. UI: a single dropdown in `PageHeader` with two clearly-separated sections (Appearance + Palette).

## Non-goals

- Custom user-authored palettes / palette editor.
- Per-page palette overrides.
- Auto-mode switching when palette changes (e.g. Plum is dark-first, but we will not force `mode=dark` when the user picks Plum — they keep whatever mode they had).
- Animated transitions between themes (a CSS transition class can be added later if needed; not in V1).
- Component-level redesigns. This change is purely token-level: every component already uses `bg-background`, `text-foreground`, `border-border`, etc. — they automatically pick up new values.

## Architecture

### Two independent dimensions on the document root

```html
<html data-palette="aurora" class="dark">
```

- `data-palette` — one of `slate | aurora | indigo | plum | clay`.
- `class="dark"` — present iff dark mode is active. (Already managed by the existing `applyMode` helper; we do not change that.)

### CSS variable layering in `globals.css`

Every palette declares **two** rule blocks:

```css
[data-palette="<name>"]        { /* light tokens */ }
[data-palette="<name>"].dark   { /* dark tokens */ }
```

The current `:root { … }` and `.dark { … }` selectors are renamed to `[data-palette="slate"]` and `[data-palette="slate"].dark` respectively. The default `data-palette="slate"` attribute is set on `<html>` at hydration so unbranded users get exactly the current look.

### Token surface

Every palette MUST define the same set of CSS variables — the union of what shadcn already uses plus chart channels. Specifically:

| Group              | Variables                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| Surface            | `--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`     |
| Brand              | `--primary`, `--primary-foreground`, `--accent`, `--accent-foreground`                                 |
| Neutrals           | `--secondary`, `--secondary-foreground`, `--muted`, `--muted-foreground`                               |
| Form / focus       | `--border`, `--input`, `--ring`                                                                        |
| Semantic           | `--destructive`, `--destructive-foreground`, `--success`, `--warning`                                  |
| Charts             | `--chart-1` … `--chart-8`                                                                              |

Values use the existing HSL-component format (`H S% L%`), consumed by Tailwind via `hsl(var(--foo))`. New chart vars use the same convention.

### Theme store

`apps/web/src/stores/theme-store.ts` extends to:

```ts
type ThemeMode = "light" | "dark" | "system";
type Palette = "slate" | "aurora" | "indigo" | "plum" | "clay";

interface ThemeStore {
  mode: ThemeMode;
  palette: Palette;
  setMode: (mode: ThemeMode) => void;
  setPalette: (palette: Palette) => void;
  reset: () => void;  // restores mode=system, palette=slate
}
```

`setPalette` writes `document.documentElement.dataset.palette = palette`. `applyMode` is unchanged.

`onRehydrateStorage` applies both mode and palette on first load.

Persistence stays at key `md.theme.v1` — zustand-persist's `merge` callback fills missing fields with defaults, so users who only have `{mode}` saved get `palette: "slate"` injected on rehydrate. No version bump needed.

### Charts

Today `apps/web/src/components/charts/theme.ts` exports a hard-coded `palette: readonly string[]` of OKLCH literals plus light/dark text colors.

After this change:

- Replace the constant array with a function `getChartPalette(): string[]` that reads `--chart-1` through `--chart-8` from `getComputedStyle(document.documentElement)`. Cached per render via `useChartPalette()` hook in `_shared.tsx` that depends on `useThemeStore(s => s.palette)` and `useThemeStore(s => s.mode)` so chart re-renders when either changes.
- `lightTheme.textStyle.color` / `darkTheme.textStyle.color` / `axisPointer.lineStyle.color` switch to reading `--foreground` / `--muted-foreground` from CSS so chart text matches each palette's surface contrast.

The existing `useChartDark` and `applyTheme` signatures stay the same; only the source of `color` changes.

### Toggle UI

Replace `apps/web/src/components/common/theme-toggle.tsx` so the single trigger button (current Sun/Moon/Monitor icon) opens a dropdown with **two labeled sections**:

```
┌─────────────────────────┐
│ APPEARANCE              │ ← muted small-caps section header
│  ☀  Light          ●    │
│  🌙 Dark                │
│  💻 System              │
│ ─────────────────       │
│ PALETTE                 │
│  ⬛ Slate           ●    │ ← swatch + label
│  🟣 Aurora              │
│  🔵 Indigo              │
│  🟣 Plum                │
│  🟠 Clay                │
└─────────────────────────┘
```

- Trigger icon stays the existing mode icon (Sun/Moon/Monitor) so the header chrome doesn't grow.
- Section headers use shadcn's `DropdownMenuLabel`, items use `DropdownMenuItem`, divider uses `DropdownMenuSeparator`.
- Each palette item shows a small color swatch (a 12×12 div with `bg-[hsl(...)]` for that palette's primary) instead of an emoji.
- Selected item gets the same `●` marker the existing component uses.

i18n keys (zh + en):
- `common:theme.appearance` — section label
- `common:theme.palette.title` — section label
- `common:theme.palette.slate` / `.aurora` / `.indigo` / `.plum` / `.clay` — display names

## Palette token reference

Values below are starting points; final shades may be tuned during implementation while preserving the documented "vibe." HSL written in shadcn's `H S% L%` form for direct paste into `globals.css`.

### Slate (default — values unchanged from current `globals.css`)

Light: bg `0 0% 100%`, fg `240 10% 3.9%`, primary `240 5.9% 10%`, border `240 5.9% 90%`. (See current file for full set.)
Dark: bg `240 6% 8%`, fg `0 0% 98%`, primary `0 0% 98%`, border `240 3.7% 15.9%`.
Charts (new — fills the existing hard-coded palette into CSS vars):
`--chart-1: 250 60% 55%`, `--chart-2: 165 50% 50%`, `--chart-3: 35 75% 55%`, `--chart-4: 305 55% 55%`, `--chart-5: 95 45% 55%`, `--chart-6: 200 50% 50%`, `--chart-7: 20 60% 50%`, `--chart-8: 130 40% 55%`.

### Aurora (#FFFFFF / #5B5BD6 / #0A0A0A)

| Token             | Light          | Dark           |
| ----------------- | -------------- | -------------- |
| background        | `0 0% 100%`    | `0 0% 4%`      |
| foreground        | `0 0% 4%`      | `0 0% 98%`     |
| card              | `0 0% 100%`    | `240 4% 7%`    |
| primary           | `240 60% 60%`  | `240 100% 77%` |
| primary-foreground| `0 0% 100%`    | `240 6% 10%`   |
| secondary         | `0 0% 98%`     | `240 6% 11%`   |
| muted             | `0 0% 98%`     | `240 6% 11%`   |
| muted-foreground  | `0 0% 45%`     | `240 5% 64%`   |
| accent            | `240 4% 96%`   | `252 95% 76%`  |
| border / input    | `0 0% 92%`     | `240 6% 13%`   |
| ring              | `240 60% 60%`  | `240 100% 77%` |

Chart palette (both modes share — readable on either base):
`240 60% 60%` (violet), `252 95% 76%` (light violet), `188 91% 43%` (cyan), `158 64% 40%` (emerald), `38 92% 50%` (amber), `330 81% 60%` (pink), `239 84% 67%` (indigo), `262 83% 58%` (purple).

### Indigo (#FAFAF7 / #635BFF / #0A1A2F)

| Token             | Light            | Dark            |
| ----------------- | ---------------- | --------------- |
| background        | `60 14% 98%`     | `213 65% 11%`   |
| foreground        | `226 36% 16%`    | `215 33% 97%`   |
| card              | `0 0% 100%`      | `213 56% 16%`   |
| primary           | `244 100% 68%`   | `244 100% 73%`  |
| primary-foreground| `0 0% 100%`      | `213 65% 11%`   |
| secondary         | `213 38% 98%`    | `217 49% 21%`   |
| muted             | `213 38% 98%`    | `217 49% 21%`   |
| muted-foreground  | `218 13% 47%`    | `217 21% 62%`   |
| accent            | `248 100% 97%`   | `188 100% 50%`  |
| accent-foreground | `244 100% 68%`   | `213 65% 11%`   |
| border / input    | `215 22% 91%`    | `215 50% 25%`   |
| ring              | `244 100% 68%`   | `244 100% 73%`  |

Charts: `244 100% 68%`, `188 100% 50%`, `158 64% 40%`, `38 92% 50%`, `0 72% 50%`, `262 83% 58%`, `45 96% 56%`, `218 100% 60%`.

### Plum (#0E0E1A / #A78BFA — dark-first)

| Token             | Light          | Dark            |
| ----------------- | -------------- | --------------- |
| background        | `240 14% 98%`  | `240 30% 8%`    |
| foreground        | `232 21% 13%`  | `240 19% 92%`   |
| card              | `0 0% 100%`    | `240 32% 13%`   |
| primary           | `263 84% 58%`  | `252 95% 76%`   |
| primary-foreground| `0 0% 100%`    | `240 30% 8%`    |
| secondary         | `250 100% 97%` | `240 33% 18%`   |
| muted             | `250 100% 97%` | `240 33% 18%`   |
| muted-foreground  | `220 9% 46%`   | `240 21% 64%`   |
| accent            | `251 91% 92%`  | `188 91% 43%`   |
| accent-foreground | `263 70% 50%`  | `240 30% 8%`    |
| border / input    | `240 13% 91%`  | `240 24% 22%`   |
| ring              | `263 84% 58%`  | `252 95% 76%`   |

Charts (dashboard-optimized 8-color set, optimized for dark base):
`252 95% 76%` (violet), `188 91% 43%` (cyan), `158 64% 40%` (emerald), `38 92% 50%` (amber), `330 81% 60%` (pink), `217 91% 60%` (blue), `83 75% 45%` (lime), `25 95% 53%` (orange).

### Clay (#F8F4EC / #C2410C / #1C1814)

| Token             | Light         | Dark            |
| ----------------- | ------------- | --------------- |
| background        | `39 47% 95%`  | `30 17% 9%`     |
| foreground        | `35 33% 13%`  | `42 47% 90%`    |
| card              | `48 100% 98%` | `28 14% 13%`    |
| primary           | `21 90% 40%`  | `25 95% 61%`    |
| primary-foreground| `0 0% 100%`   | `30 17% 9%`     |
| secondary         | `42 47% 90%`  | `28 18% 15%`    |
| muted             | `42 47% 90%`  | `28 18% 15%`    |
| muted-foreground  | `38 22% 34%`  | `35 25% 64%`    |
| accent            | `30 90% 37%`  | `43 96% 56%`    |
| accent-foreground | `0 0% 100%`   | `30 17% 9%`     |
| border / input    | `39 28% 85%`  | `27 15% 19%`    |
| ring              | `21 90% 40%`  | `25 95% 61%`    |

Charts: `21 90% 40%` (terracotta), `30 90% 37%` (amber-700), `83 64% 35%` (lime-700), `192 80% 30%` (cyan-800), `0 70% 41%` (red-700), `19 80% 26%` (deep brown), `35 90% 36%` (yellow-700), `83 64% 30%` (lime-800).

## File changes

| File                                                              | Change                                                                                                                |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/styles/globals.css`                                 | Rewrite `:root` / `.dark` blocks into 10 `[data-palette="…"]` selectors (5 palettes × light/dark). Add `--chart-1..8`. |
| `apps/web/src/stores/theme-store.ts`                              | Add `palette` field, `setPalette`, dataset write; update `reset` and `onRehydrateStorage`.                            |
| `apps/web/src/stores/theme-store.test.ts`                         | Cover `setPalette`, `reset`, dataset side-effect, default value when no persisted state.                              |
| `apps/web/src/components/common/theme-toggle.tsx`                 | Two-section dropdown with palette swatches.                                                                           |
| `apps/web/src/components/charts/theme.ts`                         | Replace const `palette` with `getChartPalette()` reading CSS vars.                                                    |
| `apps/web/src/components/charts/_shared.tsx`                      | Subscribe to palette + mode in `useChartPalette()`; thread through chart components that previously consumed `palette`.|
| `apps/web/src/main.tsx`                                           | Set `document.documentElement.dataset.palette = "slate"` before React hydration so the first paint matches storage.   |
| `apps/web/src/locales/zh-CN/common.json`                          | New `theme.appearance`, `theme.palette.title`, `theme.palette.{slate,aurora,indigo,plum,clay}` keys.                   |
| `apps/web/src/locales/en-US/common.json`                          | Same set in English.                                                                                                  |

## Testing

1. **Store tests (Vitest, jsdom)** — extend `theme-store.test.ts`:
   - `setPalette("aurora")` writes `data-palette="aurora"` on `<html>`.
   - `reset()` restores both `mode=system` and `palette=slate`.
   - Rehydration with old shape `{mode: "dark"}` (no palette field) yields `palette: "slate"` and applies it to DOM.

2. **Visual smoke test (Playwright, e2e)** — one new spec `e2e/theme-palette.spec.ts`:
   - For each palette × {light, dark}: navigate to `/`, set `localStorage.md.theme.v1` to that combination, reload, assert `<html>` has the right `data-palette` and `class`, screenshot the dashboard. Snapshots gate visual regressions; tolerance set generous since charts have animations.

3. **Manual contrast check** — at implementation time, run the contrast pairs `bg/foreground`, `card/card-foreground`, `primary/primary-foreground`, `muted/muted-foreground`, `border/background` through a WCAG checker for each palette × mode. AA (4.5:1) for body text, AA Large (3:1) for primary buttons. Adjust shades that fail.

## Accessibility

- All palettes must pass WCAG AA for text-on-surface pairs above. The Plum-light variant is the riskiest (low-saturation violet on near-white) — reserve a contrast pass before merging.
- Focus rings (`--ring`) MUST remain visibly distinct from `--background` in both modes. We standardize on a 2px outline using `--ring` in component primitives — this is already the shadcn default.
- Respect `prefers-color-scheme` for `mode=system`. Palette has no system equivalent — default is `slate`.
- Respect `prefers-reduced-motion` — palette switching is an instant CSS variable swap; no animation.

## Migration & rollout

1. Ship behind no flag — pure CSS additions plus a new optional store field. Slate stays the default; existing users see no change at first paint.
2. After merge, announce the new themes in-app (small toast or "What's new" entry — out of scope here, mention so PM can plan it).
3. Existing `localStorage` entries are forward-compatible (zustand merges defaults). No migration script needed.

## Open questions

None blocking implementation. One note for the implementation plan:

- The toggle dropdown grows to ~9 items. If header real-estate becomes tight on mobile, the implementation plan can split it into two icon buttons (a paint-bucket / palette icon next to the existing sun/moon). Out of scope for V1; we ship the combined dropdown first.
