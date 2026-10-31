# HAMLOCK design system

## Overview

HAMLOCK is a single-page Sepolia time lock with a live hamster card. The existing dark green terminal, dot-matrix title, pixel wheel and lime primary action remain its visual identity. Larger data, lowercase dry copy and a red live status make this update louder without adding a new visual system.

Source of truth: `web/src/styles.css`, `web/src/App.tsx`, `web/src/HamsterCard.tsx`, `web/src/live.ts`, `web/src/Wallet.tsx` and `web/src/Modal.tsx`. There is one dark theme. The form precedes the hamster on phones; wallet utility stays in the header. No supplied API/contract value is replaced with a sample number.

## Colors

The `:root` block in `web/src/styles.css:22` defines hex primitives and semantic role tokens. Components consume the role tokens. Local art and wallet marks retain their existing colors.

| Role token               | Resolved value | Use                                         |
| ------------------------ | -------------- | ------------------------------------------- |
| `--color-bg`             | `#0e110f`      | Page, amount field, ink on lime/red fills   |
| `--color-surface`        | `#151b15`      | Console, bag, dialogs, table header         |
| `--color-hover`          | `#1b241b`      | Neutral hover/press                         |
| `--color-border`         | `#253125`      | Structural boundaries                       |
| `--color-control-border` | `#40513b`      | Inputs and neutral controls                 |
| `--color-text`           | `#f0f1e8`      | Main text                                   |
| `--color-muted`          | `#a5b29b`      | Hints, units, supporting text               |
| `--color-accent`         | `#d9f865`      | Main action, slider, settled progress       |
| `--color-accent-hover`   | `#e5ff92`      | Lime hover/press                            |
| `--color-on-accent`      | `#0e110f`      | Main action ink                             |
| `--color-danger`         | `#ffab98`      | Errors and destructive confirmation         |
| `--color-danger-bg`      | `#38221e`      | Destructive outline hover                   |
| `--color-danger-hover`   | `#ffbfaf`      | Destructive fill hover/press                |
| `--color-progress-live`  | `#6b7d4e`      | Additional live progress beneath settlement |
| `--color-focus`          | `#f0f1e8`      | 2px keyboard ring                           |
| `--color-live`           | `#ff544f`      | LIVE badge fill                             |
| `--color-off-air-bg`     | `#2b302e`      | OFF AIR badge fill                          |
| `--color-off-air-text`   | `#b0b6b2`      | OFF AIR text                                |

Rendered badge measurements: `#0e110f` on `#ff544f` is **6.00:1**; `#b0b6b2` on `#2b302e` is **6.51:1**. These pairs were measured from computed styles in the interaction suite. The probe/axe checks cover other measured text pairs; they do not establish contrast inside third-party video. Status includes words and a dot, so color is redundant.

## Typography

Local WOFF2 files in `web/public/fonts/` supply Geist 400/600 and Doto 900; their existing licenses remain alongside them. Geist with Arial/sans-serif fallback serves prose and controls. Doto with body fallback serves only the product title. The data stack is `SFMono-Regular, Consolas, Liberation Mono, monospace`. Fonts loaded successfully in the production check.

| Token            | Desktop default    | Role                                                |
| ---------------- | ------------------ | --------------------------------------------------- |
| `--text-small`   | `0.8125rem` / 13px | Hints, table, metadata, badges                      |
| `--text-body`    | `1rem` / 16px      | Copy, controls, field labels                        |
| `--text-section` | `1.25rem` / 20px   | Section headings; mobile tagline                    |
| `--text-stat`    | `2rem` / 32px      | Amounts, pot values, desktop tagline, distance unit |
| `--text-number`  | `3rem` / 48px      | Main distance number, rules heading                 |
| `--text-hero`    | `7rem` / 112px     | Product title                                       |

At ≤680px, the hero token is 4rem/64px; at ≤360px, 3.5rem/56px. Its final rule caps the result with `min(var(--text-hero), 16.4vw)` to avoid title overflow with text enlargement. The probe found six rendered sizes per tested width and three families/weights (400, 600, 900).

Body line height is 1.5; rules and confirmation copy use 1.6; headings use 1.15; the display title and main distance use 1. Title tracking is −0.06em, section headings/tagline −0.025em, and distance −0.04em. Body spacing is natural. Headings balance; descriptions wrap prettily. Long rules are capped at 65ch. Numbers use tabular numerals. Full amounts wrap instead of clipping. The native amount input is 32px, above the iOS input-zoom threshold.

The requested lowercase copy lives in the source. Preserve the explicitly uppercase HAMLOCK, LOCK IT, CASH OUT, PAPER HAND IT, WATCH LIVE, LIVE/OFF AIR and wheel status/mood strings. Do not replace them to satisfy a generic casing check.

## Layout

The shell is at most 1248px including padding: 48px inline normally, 32px at 681–1080px, 20px at ≤680px and 16px at ≤360px. The existing spacing palette is 4, 8, 12, 16, 24, 32, 48 and 64px (`--space-1`…`--space-8`). Existing declarations mostly use those pixel values directly; changing a spacing variable alone does not rewrite them.

The hero is a title and copy pair, followed immediately by the console. Desktop has two equal columns separated by a structural rule. At ≤1080px the hero copy moves below the title. At ≤680px the console stacks form first; shorter heading/form gaps keep the primary action on the first screen. At 390 × 844 its bottom was about 702px. The hamster media area and iframe remain **16:9**, including at 320, 390, 800 and 1440px.

The broadcast header places status and watch/close at opposite edges. Its 44px control row reserves room through state changes. The hamster readout wraps when needed. Off-air details wrap independently. Stats change from four to two columns at 680px. Bag values change from three to two columns, with the reward row spanning both. Actions wrap and stack at narrow widths. The table retains all four columns and hides only decorative ranks below 360px. Rules are five ordered lines in one list, alongside the large heading on desktop and below it on mobile. The footer wraps its note and two links.

There is no fixed navigation over content. Dialogs become bottom sheets at ≤680px and include safe-area padding. Checked reflow widths: 320, 390, 680, 800 and 1440px. Independent 200% text enlargement was checked at 390px. Native browser zoom and RTL/localized variants were not tested; this page is English only.

## Elevation & Depth

The system is flat. Tonal fills group content; 1px borders provide structure. There are no card shadows, blur, glow, staged entrances or automatic wheel animations. The empty bag uses a dashed outline. Native dialogs use the top layer, inert background and black backdrop at 78% opacity. The player replaces the media region rather than opening another modal.

## Shapes

Console and desktop dialog radii are 8px. Controls and bag/table surfaces use 4px; progress and badges use 2px. Mobile dialogs have 12px top corners. The slider retains its rectangular thumb and native keyboard behavior. Pixel art keeps its stepped geometry. Iframes have no decorative frame and fill their 16:9 region.

## Components

| Component / pattern | Source                                | Implemented behavior                                                                                                                                                                                                                                                                                      |
| ------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HamsterCard`       | `web/src/HamsterCard.tsx`             | Props: fresh `telemetry`, pending flag, page clock. Art, red LIVE or gray OFF AIR, watch/close, provider iframe, local schedule, follow link, wheel data and required mood. Keyboard focus moves to close after watch and back after manual close. Automatic provider changes preserve focus in the form. |
| Live data           | `web/src/live.ts`                     | One `LIVE_URL` endpoint object; schema/date checks; fixed-origin provider URL builder; 30-second visible-page polling, abort/timeout cleanup, independent schedule failure. No arbitrary feed URL becomes an iframe.                                                                                      |
| `Wallet`            | `web/src/Wallet.tsx`                  | Existing EIP-6963 discovery, Coinbase/Smart Wallet, phone open-in links, switch/add network, full address and disconnect. Lowercase labels; pending and recoverable errors.                                                                                                                               |
| `Modal`             | `web/src/Modal.tsx`                   | Native dialog, close/backdrop/Escape, focus boundaries and native return. Destructive submission retains the busy guard.                                                                                                                                                                                  |
| Lock form           | `web/src/App.tsx`, `.lock-panel`      | Contract-derived range/limits/work units; labelled amount with decimal keyboard; field-linked errors and focus on invalid input; lime LOCK IT; duplicate-bag state.                                                                                                                                       |
| Buttons             | `web/src/styles.css`                  | `.primary` lime, `.secondary` neutral, `.stream-button` neutral 44px, `.danger-button` outlined destructive, `.danger-solid` confirmation. Hover, active, visible focus and disabled states. Primary actions are ≥48px high.                                                                              |
| Bag progress        | `web/src/App.tsx`, `web/src/logic.ts` | Settled progress with a secondary live layer; work-to-km conversion uses `WORK_PER_KM`. Copy reports additional unsettled km. Contract eligibility controls cash-out; unknown readings remain unknown.                                                                                                    |
| Break confirmation  | `web/src/App.tsx`                     | Requested compact sentence with full refund, penalty and forfeited reward; “nvm” / “do it.” `breakAmounts` remains wei-exact, and rewards are rechecked before signing.                                                                                                                                   |
| Transaction status  | `web/src/App.tsx`                     | Stable polite region with wallet/pending/success/error and explorer link. Existing simulation, receipt/event verification and duplicate-submit protection.                                                                                                                                                |
| Pot / diamond paws  | `web/src/data.ts`, `web/src/App.tsx`  | Existing contract totals and event-derived scores; refresh, pagination, scanning/empty/failure/last-reading states.                                                                                                                                                                                       |

Transitions name background/color/border and last 120ms. Hover is capability-gated. Reduced motion disables transitions and smooth scrolling. There is no page-load or endless animation. Video starts only after watch; close removes it. Provider-internal controls, captions and animations were not reviewed against a real live stream.

## Do's and Don'ts

- Reuse the shell, semantic color roles, six-size scale and existing native controls.
- Keep the form first on mobile and its action on the first 390px screen.
- Keep broadcast state, wheel telemetry and contract unlock eligibility separate.
- Keep both service URLs together in `LIVE_URL`. Validate IDs before building an embed.
- Show exact ETH amounts for consequential actions; use unknown markers for missing reads.
- Preserve required dry copy and uppercase exceptions. Avoid extra slogans and decorative labels.
- For another informational section, reuse a section heading and the existing spacing/type tokens. Extra routes/themes are outside this one-page design.

Guidance: Jakub Krehel's [Better Interface](https://github.com/jakubkrehel/skills/tree/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-interface) (MIT). Documentation method adapted from Paul Bakaus's [Impeccable](https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md) (Apache-2.0). Existing complete notices remain in `docs/DESIGN_GUIDANCE_LICENSES.txt`. This document was updated for the implemented live card and degen copy.
