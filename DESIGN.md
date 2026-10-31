# HAMLOCK design system

## Overview

HAMLOCK is a single-page Sepolia time-lock interface. A dot-matrix title, a pixel hamster wheel, and lime indicators on a dark green instrument panel carry the visual idea. The lock form is the first task; explanatory copy, the jar, pool data and leaderboard follow in reading order.

The final implementation is in `web/src/styles.css`, `web/src/App.tsx`, `web/src/Wallet.tsx` and `web/src/Modal.tsx`. There is one dark theme. Pixel lettering is reserved for the product title; controls and prose use a readable sans serif.

## Colors

The `:root` block in `web/src/styles.css` defines the primitives and role tokens. Components use role tokens. Local artwork and wallet marks retain their own colors.

| Role token               | Value     | Use                                               |
| ------------------------ | --------- | ------------------------------------------------- |
| `--color-bg`             | `#0e110f` | Page, amount field, ink on filled buttons         |
| `--color-surface`        | `#151b15` | Console, jar, dialog, table header                |
| `--color-hover`          | `#1b241b` | Neutral control hover/press                       |
| `--color-border`         | `#253125` | Structural boundaries and separators              |
| `--color-control-border` | `#40513b` | Inputs, secondary controls, empty jar outline     |
| `--color-text`           | `#f0f1e8` | Primary text                                      |
| `--color-muted`          | `#a5b29b` | Hints, units and supporting text                  |
| `--color-accent`         | `#d9f865` | Primary action, settled progress, brand detail    |
| `--color-accent-hover`   | `#e5ff92` | Primary action hover/press                        |
| `--color-on-accent`      | `#0e110f` | Primary action label                              |
| `--color-danger`         | `#ffab98` | Errors and destructive action fill                |
| `--color-danger-bg`      | `#38221e` | Destructive outline control hover                 |
| `--color-danger-hover`   | `#ffbfaf` | Destructive filled control hover/press            |
| `--color-progress-live`  | `#6b7d4e` | Lighter live progress beneath the settled segment |
| `--color-focus`          | `#f0f1e8` | Two-pixel keyboard focus ring                     |

The dialog backdrop is black at 78% opacity. Status always includes text. Settled and live progress have separate labels and legend keys; API data never enables opening. The production probe and axe scans passed their measured text contrast checks. These are automated measurements, not a claim that every possible rendered pair has been manually measured.

## Typography

Local WOFF2 files in `web/public/fonts/` provide Geist regular (400), Geist semibold (600), and Doto (900). Font licenses are in the same directory. They are copied to `dist/fonts/`; there is no runtime font CDN.

| Token            | Default            | Role                                       |
| ---------------- | ------------------ | ------------------------------------------ |
| `--text-small`   | `0.8125rem` / 13px | Hints, labels, table, units                |
| `--text-body`    | `1rem` / 16px      | Prose, buttons, form labels                |
| `--text-section` | `1.25rem` / 20px   | Section headings, desktop hero explanation |
| `--text-stat`    | `1.5rem` / 24px    | Stats, amount field and jar values         |
| `--text-number`  | `2.5rem` / 40px    | Distance output, rules heading             |
| `--text-hero`    | `6rem` / 96px      | Doto product title                         |

At widths up to 680px, the hero token becomes 4rem; up to 360px it becomes 3.5rem. The final `h1` rule caps the rendered size at `16.4vw` so independent text enlargement cannot push the word offscreen. At the checked 390px and 1440px widths, six distinct sizes render. Weights are 400, 600 and 900.

Body line height is 1.5, explanatory rules use 1.6, headings use 1.15, and the display title uses 1. Title tracking is −0.06em, section headings −0.025em, the large distance −0.04em; body copy is naturally spaced. Headings balance their wrapping. Long prose is capped at 65ch. Changing amounts, work, ranks and timers use tabular numerals and the system monospace stack `SFMono-Regular, Consolas, Liberation Mono, monospace`.

Amounts and refund values remain fully visible and can wrap. Wallet summaries use conventional short addresses; the wallet dialog exposes the full checksum address, and leaderboard addresses link to Etherscan.

## Layout

The page shell is at most 1248px wide including its padding. Desktop inline padding is 48px. Between 681px and 1080px it becomes 32px; up to 680px it is 20px; up to 360px it is 16px.

The declared spacing palette `--space-1` through `--space-8` is 4, 8, 12, 16, 24, 32, 48 and 64px. Component declarations currently use these explicit pixel values rather than referencing the spacing variables. Keep additions on that palette; changing a spacing variable alone will not update the existing declarations.

Desktop uses two equal console columns: lock form and hamster panel. Mobile stacks the form first. The hero explanation moves below the title at 1080px. Stats use four columns, becoming two at 680px. Rules use a heading column and two text columns, becoming one vertical sequence at 680px. The jar overview uses three columns, then two with a full-width reward row on mobile. Table columns remain visible; ranks drop at 360px, while the wallet link and all scores remain.

Headings and utility rows wrap. Mobile headers can wrap during text enlargement. The jar actions stack at narrow widths. The footer wraps and drops its decorative signoff below 1080px. No fixed navigation covers content. Checked widths: 320, 390, 680, 800 and 1440px; independent 200% text enlargement also passed reflow checks. See `docs/WEBSITE_VALIDATION.md` for coverage boundaries.

## Elevation & Depth

The system is flat: no card shadows, glow, blur or entrance animation. Thin borders establish the console, inputs, jar and table; a dashed border marks the empty jar. Tonal surfaces group content. Native dialogs use the browser's top layer and an opaque-enough backdrop; their page background becomes inert.

## Shapes

Structural borders are 1px. The console and desktop dialog use an 8px radius; controls and jar/table surfaces use 4px; the progress track uses 2px. Mobile dialogs use 12px top corners and sit at the bottom with safe-area padding. Artwork keeps deliberately stepped pixel geometry. The slider has a rectangular thumb and is a native range input.

## Components

| Component or pattern | Source                                                  | Behavior                                                                                                                                                                                                                             |
| -------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Wallet`             | `web/src/Wallet.tsx`                                    | One header control; named EIP-6963 wallets, Coinbase, mobile open-in links, switch/add Sepolia, full address and disconnect. Pending rows and recoverable rejection messages.                                                        |
| `Modal`              | `web/src/Modal.tsx`                                     | Native dialog with background inertness, explicit Tab boundary handling, Escape/backdrop/close button, native focus restoration. Bottom sheet on mobile.                                                                             |
| Lock form            | `web/src/App.tsx`, `.lock-panel`                        | Native range; contract-derived bounds and work units; labelled decimal input; field-linked errors and focus on invalid input; primary Lock ETH action.                                                                               |
| Buttons              | `web/src/styles.css`                                    | `.primary` lime, `.secondary` neutral, `.danger-button` destructive outline, `.danger-solid` destructive confirmation. Controls have visible hover, focus, active and disabled states. Primary touch actions are at least 48px tall. |
| Jar progress         | `web/src/App.tsx`, `getProgress` in `web/src/logic.ts`  | Settled baseline-relative progress, lighter live layer, work and calibrated km, pending reward, deadline and contract-authorized actions. Missing/stale data is explicitly labelled.                                                 |
| Break confirmation   | `web/src/App.tsx`, `breakAmounts` in `web/src/logic.ts` | Full precision principal refund, deposit penalty and forfeited reward. Keep my jar cancels. A changed reward requires renewed confirmation.                                                                                          |
| Transaction status   | `web/src/App.tsx`                                       | Stable polite live region for wallet, pending, success and error states; Etherscan receipt link; concurrent submissions prevented. Receipt must contain the expected owner event.                                                    |
| Pool stats           | `useChainState` in `web/src/data.ts`                    | Same-block contract reads, manual refresh, last-reading/error labels. Unknown values render as an em dash, never a made-up zero.                                                                                                     |
| Leaderboard          | `web/src/data.ts`, `rankScores` in `web/src/logic.ts`   | Chunked event discovery, contract score reads, deterministic ranking and pagination. Empty, scanning, error and stale states.                                                                                                        |

Transitions name background, color and border color and last 120ms. Hover styling is pointer-capability gated. Reduced motion disables transitions and smooth scrolling. There is no automatic spinning or blinking animation.

## Do's and Don'ts

- Reuse semantic color tokens, the six-size scale, existing buttons and the page shell.
- Keep the form before the illustration on mobile; keep the main action visible on the first 390px screen.
- Keep live telemetry clearly labelled and separate from contract eligibility.
- Use full exact ETH strings for consequential amounts. Do not truncate a refund or imply zero when a read fails.
- Use a native control or the existing dialog instead of rebuilding keyboard behavior.
- For an additional informational section, use the shell, a section heading, normal prose and the existing spacing palette. Additional routed pages are outside this one-page design.
- Avoid extra slogans, tracked uppercase labels, nested cards, unrelated accent colors and continuous motion.

Design guidance applied from Jakub Krehel's [Better Interface](https://github.com/jakubkrehel/skills/tree/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-interface) (MIT). Documentation method adapted from Paul Bakaus's [Impeccable](https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md) (Apache-2.0). Full notices: `docs/DESIGN_GUIDANCE_LICENSES.txt`.
