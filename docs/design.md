# Design tokens — Ramp Teach

**Every page is labeled "Unofficial demo inspired by Ramp's design".** The root layout renders
`src/components/ui/DemoBanner.tsx` on every route; fixture apps additionally show their own
"Demo fixture" label (e.g. "Fixture vendor portal — synthetic data").
No Ramp logos, trademarks, or copied assets. Inspired-by only.

## Color
| Token | Value | Use |
|---|---|---|
| `surface` | `#FFFFFF` | page background (white) |
| `ink` | `#1F1F1F` | primary text (near-black) |
| `ink-muted` | `#5C5C5C` | secondary text |
| `ink-faint` | `#8A8A8A` | eyebrows, captions |
| `line` | `#E6E6E3` | 1px card borders, table rules |
| `wash` | `#F7F7F5` | subtle fills (table header, hover) |
| `accent` | `#E4F222` | **lemon. Reserved for primary actions and the recommendation banner. Nothing else.** |
| `pass` / `fail` / `warn` | `#1D7A46` / `#B42318` / `#A15C07` | check result text + badges only |

Tailwind v4 classes: `bg-surface text-ink border-line bg-wash bg-accent text-pass text-fail text-warn`.
Tokens live in `src/app/globals.css` (`@theme`).

## Type
- Body: grotesque — **Inter** (variable, self-hosted via `@fontsource-variable/inter`); Archivo fallback. `font-sans`.
- Display: serif — **Newsreader** (`@fontsource-variable/newsreader`); Source Serif 4 fallback. `font-display`.
  Use for page titles and the big numbers on the recommendation banner, sparingly.
- Sizes: page title `text-4xl font-display tracking-tight`; card title `text-lg font-semibold`; body `text-sm`/`text-base`.

## Money
- Always tabular figures and right-aligned: `src/components/ui/Money.tsx` (`.tabular block text-right`).
- Money columns in tables: `<td className="text-right tabular">`. Header cells for money columns also right-aligned.
- Format with `src/lib/money.ts fmtMoney` ("$1,234.50").

## Layout
- Bento grid of cards: `src/components/ui/Card.tsx` — 1px `border-line`, `rounded-[14px]`, `p-6`, white.
- Generous whitespace: `gap-6` between cards, `max-w-6xl` page container, `py-10`.
- Tables: no zebra striping; `border-b border-line` row rules; `bg-wash` header row; `text-sm`.

## Components (shared, in `src/components/ui/`, owned by orchestrator)
`Card`, `Button` (`primary` = lemon, `secondary`, `danger`), `Money`, `Badge`, `ModeBadge`, `DemoBanner`.
Lanes may add lane-local components under their own folder (`src/components/receipt/`, `src/components/fixtures/`).

## Recommendation banner
Full-width card with `bg-accent` (lemon) background, near-black text:
eyebrow "Agent recommendation", display-serif word (**Approve** / **Dispute** / **Review**),
the reasons list, and a `ModeBadge` showing how the receipt was produced. The human decision
buttons sit directly beneath it. The agent never decides; the banner says "Recommendation — a human decides."

## Mode labels
Anything produced by the system shows how it was produced: `ModeBadge` with
`real` ("Real AI (Claude)"), `scripted` ("Scripted (Playwright, no AI)"), `mock`/`deterministic` ("no AI").
