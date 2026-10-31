# HAMLOCK live card and copy validation

**Complete for the stated scope**, with the external/manual limits below. This is local contributor evidence, not independent certification. The existing contract and its address were not changed. No transaction was signed or broadcast, and nothing was deployed or published.

## Outcome

| Area                                             | Final result                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Requested changes                                | Implemented; no fabricated live readings or video                                  |
| Broken features found in final checked flows     | 0                                                                                  |
| Product and main action on first screen at 390px | Yes; LOCK IT ends at approximately 702px in a 390 × 844 viewport                   |
| Production build / typecheck                     | Both passed, exit 0                                                                |
| Interaction suite                                | **33/33 passed**, exit 0; Chromium and WebKit                                      |
| taste@1                                          | **14/16 raw checks**, exit 0; casing and slogan flags are explicit brief overrides |
| New badge text contrast                          | LIVE 6.00:1; OFF AIR 6.51:1                                                        |
| Automated accessibility                          | Zero axe violations in six representative page/dialog/player states                |
| Metadata                                         | Title, description, favicon, og:title and local og:image present                   |
| Static export                                    | Root `dist/`, relative asset URLs, tested under `/preview/`                        |

One visual idea carries the site: a dark dot-matrix terminal where a lime lock action sits beside a pixel hamster wheel, with red reserved for a live broadcast.

## Scope and assumptions

This continues the existing Vite/React/TypeScript site. The work replaces its external livestream link with an in-card player and applies the supplied copy across the hero, form, hamster, bag, break flow, pot, leaderboard, rules, share, footer, wallet prompts and metadata. Existing wallet discovery, chain configuration, ABIs, deployment verification and transaction construction remain intact.

Runtime sources remain the verified Sepolia deployment and the Squeekchain status API. The new `LIVE_URL` object in `web/src/live.ts:4` holds both live-service URLs. No real balances, rankings, start times or broadcast IDs are invented. The requested “~10 km on a good night” is provided explanatory copy. Contract rules are interpolated from getters, including bounds, work units, penalty and duration.

Ordinary design choices: preserve the existing fonts, green/lime palette and pixel art; add only live/off-air tokens; enlarge existing numeric roles; show unknown schedule data as “tbd”; use the API's supplied occurrence even if its start is earlier than the current time. A live descriptor with unsupported/invalid playback offers the original X destination and never creates an unsafe iframe. This makes failure usable without guessing a stream.

The rendered export was served at `/preview/`. Browser fixtures intercept RPC, telemetry, descriptor, schedule, wallet and provider iframe responses. Test accounts are generated at runtime and never enter the product. `player-fixture.png` explicitly shows fixture content, not a real video. The real service was idle during read-only verification.

## Requirements

| Requirement                                          | Evidence / status                                                                                                                                                                        |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| “Do not touch the contract or its address”           | Met: `src/Hamlock.sol`, `web/src/chain.ts`, ABIs and `web/deployment.json` have no diff; hashes matched the existing deployment.                                                         |
| “Keep both URLs as one constant at the top”          | Met: `LIVE_URL` in `web/src/live.ts:4`.                                                                                                                                                  |
| “Poll every 30 seconds while the page is visible”    | Met: visible-only interval, abort on hide, immediate refresh on return; fake-clock test checks both endpoints and 90 simulated hidden seconds.                                           |
| “state is live AND validUntil is in the future”      | Met: eligibility helper, current-time click guard and expiry timer; six non-live/null/expired cases plus expiry while playing pass.                                                      |
| X / YouTube / Twitch iframe patterns                 | Met: fixed origins/parameters, 20 refused ID/payload cases and five accepted boundary cases. Twitch uses the current hostname. All providers opened/closed in both engines.              |
| “A close button returns to the pixel art”            | Met: close removes iframe, restores art and focus; actual 16:9 geometry checked at 320/390/800/1440.                                                                                     |
| OFF AIR / local next start / follow link             | Met: gray text badge, `occurrence.startAt`, visitor-local 24-hour display; America/Los_Angeles fixture checks conversion. Missing/failed schedule stays unknown.                         |
| “If LIVE_URL fails, fall back to the old x.com link” | Met: descriptor HTTP/schema failures show `https://x.com/squeekchain`; a later successful poll recovers.                                                                                 |
| “Wheel stats ... stay as they are”                   | Met: existing telemetry freshness/rpm calculation and SPINNING/IDLE remain, independently of video state; required mood copy is additional.                                              |
| Exact degen copy and deleted filler                  | Met: source review and rendered exact-copy test; five rules; exact share text and URL; full-precision requested break sentence. Operational error/retry text is shortened and lowercase. |
| “Every number ... contract or APIs”                  | Met: getter-derived limits, work conversion, duration, penalty, pot, jar and scores; live API rpm/time. Unknown data is never replaced with a sample.                                    |
| Dark dot-matrix, lime, red LIVE, larger numbers      | Met: retained assets/families; 32px statistics and 48px distance; red live token.                                                                                                        |
| Usable primary interactions / responsive layout      | Met: form validation, mock lock/open/break/reconfirmation, wallet states, share, reads/retry, player states, reflow, keyboard and focus checks.                                          |
| `dist/index.html` and complete local assets          | Met: existing build emits root `dist/` with `base: './'`; fonts, marks, OG and dynamic chunks load under a subpath.                                                                      |
| Source and lockfile                                  | Met: `web/` source and existing unchanged manifest/lockfile retained. No added dependencies or configuration changes.                                                                    |
| First screen at 390px / metadata                     | Met: source, screenshot, probe and first-screen measurement; local 1200 × 630 share artwork regenerated with the new copy.                                                               |
| Six-domain review / DESIGN / README                  | Met: review below, root `DESIGN.md` reflects source; README includes install, preview, rebuild and checks.                                                                               |
| 8 MiB and forbidden paths                            | Met: conservative changed/new file size comfortably below the limit; no dependency/cache archives, submodule or forbidden-path changes. Final audit follows below.                       |

Publishing, IPFS pinning and domain updates happen after this handoff and are outside this implementation.

## Better Interface coverage

The pinned Better Interface workflow and all six domains' core principles were applied while building, followed by a consolidated source/rendered review. Attribution and both original license notices remain in `docs/DESIGN_GUIDANCE_LICENSES.txt`.

| Domain                  | Coverage and evidence                                                                                                                                                                                                                                                                                                                       | Limits / not applicable                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Accessibility — Checked | Native range/buttons/links/dialog; persistent labels; error relationships; keyboard wallet flow, Escape, focus trap/return; watch/close focus; status text; ≥44px new stream controls. axe scans cover disconnected, wallet, bag, break, live-art and player-fixture states. Viewed a focused close control and keyboard dialog screenshot. | No screen reader or physical assistive technology. Real provider controls/captions not reviewed.               |
| Layout — Checked        | Production screenshots at 390/1440, measured reflow at 320/390/680/800/1440, player ratios, first-screen action, full-precision break amounts, independent 200% text enlargement. No measured horizontal overflow, text overlap or clipped text.                                                                                            | Native browser zoom not performed. English-only page; other locales/RTL are not supported variants.            |
| Writing — Checked       | Exact brief strings across all visible product sections; five rule lines; lowercase operational copy with retry guidance; original filler removed; sharing uses current bag km and URL.                                                                                                                                                     | Explicit uppercase action/status copy wins over the general casing guideline. No unrequested localization.     |
| Typography — Checked    | Local fonts loaded; one six-size scale; 400/600/900 weights and three families; 32px data, 48px distance; tabular numbers; wrap without clipping; amounts remain full precision.                                                                                                                                                            | Other operating-system fallback fonts/physical iOS rendering not inspected.                                    |
| Colors — Checked        | Existing semantic tokens retained; new live/off-air roles. Computed-color measurement: live dark ink on red 5.9987:1, off-air gray on gray 6.5050:1. Probe and axe contrast pass.                                                                                                                                                           | One dark theme; real cross-origin video content/backgrounds are outside these measurements.                    |
| UI details — Checked    | Flat bordered surfaces; distinct neutral stream control, lime main action and destructive confirmation; hover/active/focus/disabled states in source, selected states in screenshots; 120ms named transitions, reduced-motion path, no continuous animation.                                                                                | No staged animation to slow down. Native-device wallet transitions and provider-internal motion not inspected. |

## Findings, corrections and rechecks

All actionable findings are resolved. Source locations below refer to the final implementation, not bundle lines.

1. **High — unsafe provider input must never become an iframe.** `web/src/live.ts:68` (`matches`). A plain JavaScript `$` anchor can accept a final newline, despite the ID character class. The URL builder now compares the complete regex match to the original value and uses only fixed provider origins. Recheck: 20 invalid/missing/typed/unsupported cases, including trailing newlines and query injection, create zero iframes and zero provider requests; boundary-valid IDs pass.
2. **Medium — automatic provider changes could steal form focus.** `web/src/HamsterCard.tsx:43` (`restoreWatchFocus`). An early implementation returned focus whenever the player disappeared. Focus restoration is now limited to manual close. Recheck: the provider-change fixture keeps focus in `#amount`; keyboard watch and manual close still move/return focus correctly in Chromium and WebKit.
3. **Medium — stream validity must expire between polls.** `web/src/HamsterCard.tsx:29` and `:77`. Polling alone would leave a stale player until the next response. A timeout removes it at `validUntil`; rendering and click eligibility also use current time. Recheck: expiry removes the player, restores the pixel art and OFF AIR badge without another API poll.
4. **Medium — legacy distance conversion was an approximation.** `web/src/logic.ts:42`. The prior hardcoded metres/work approximation could diverge from a jar's contract-defined km target. Conversion now divides by getter-derived `WORK_PER_KM`; the progress sentence shows only additional unsettled distance. Recheck: active progress fixture passes; a local source-function check using actual verified getter values reaches exactly 100km at the contract maximum, shows zero extra live km at the cap and stays unknown without the conversion. See `checks/distance.json`.
5. **Validation repair — stale selectors and ambiguous connect labels.** `web/scripts/validate.mjs:1199`. Existing tests expected the old copy and disappearance of the whole live-progress sentence on outages. Tests now locate the proper header control, expect required copy and verify an empty live layer with unknown text. Two generated EIP-6963 fixture UUIDs could also collide; `:485` now guarantees they differ. These are test-harness fixes, not changes to the wallet connector. Recheck: final 33/33 suite passes.

The probe's two remaining flags are intentional brief overrides, not unresolved product defects:

- **Casing:** `web/src/HamsterCard.tsx:140` renders the explicitly requested “ASLEEP. COPE.” The brief also explicitly requires uppercase actions/statuses.
- **Slogans:** `web/src/App.tsx:318`, `:319`, `:403` and `web/src/HamsterCard.tsx:140` contain the requested tagline, explanation, testnet hint and mood. Deleting or rewriting them would violate the exact-copy request. The measured first-screen prose budget is only 26 words at 390px (limit 60).

## Commands and actual results

Commands run against the final source/export, unless marked read-only service verification:

```sh
cd web
npm ci --cache /tmp/hamlock-npm-cache --no-audit --no-fund
npm run make:og
npm run typecheck
npm run build
npm run validate
npm run verify:live -- --out test/scratch/live-verification.json
```

`typecheck`, `build`, `validate` and read-only verification exited **0**. The final interaction run has **33/33 passes** in `checks/interactions.json`. Browser tests covered the three providers, patterns/ID boundaries, expiry/non-live states, malformed descriptors, separate schedule failures, 30-second polling, background pause/return, provider replacement, fallback/recovery, exact copy, wallet discovery/rejection, network switch/add, decimal validation, transaction simulation/confirmation, break cancellation/reconfirmation, deadline opening, stale telemetry, RPC retry, event rankings, share and accessibility.

Playwright browser installation used a temporary directory outside the repository. The managed browser tool answered `Chromium distribution 'chrome' is not found at /opt/google/chrome/chrome`. Local Playwright Chromium supplied rendered inspection instead. WebKit initially lacked host libraries and an EGL display. Libraries were downloaded/extracted outside the repository; its temporary launcher was adjusted to preserve that library search path, software EGL was configured, and the host-package preflight was bypassed for this isolated setup. The actual WebKit browser then rendered and completed the form/wallet/provider tests. These support files are not deliverables and no package/configuration file in this repository was changed for them.

The final probe ran from the repository root:

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/hamlock-browsers IMD_PLAYWRIGHT=./web/node_modules/playwright/index.mjs node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste
```

It exited **0**, with **14/16 raw checks** in `checks/taste.json`. Passing checks: render, layout, targets, contrast, tracking, eyebrows, type sizes/faces, glyphs, repetition, copy budget, chrome, motion and share metadata. The exact-copy exceptions are explained above. Screenshots were viewed after generation; observations are not inferred from source alone.

A disposable `node test/scratch/logic-check.mjs` check transpiled/imported the actual `logic.ts` and used verified getter values for the completed-distance edge case (passed, exit 0; `checks/distance.json`). Scratch scaffolding is not part of the delivery.

Read-only source checks: the canonical ABI hash is `0x43bb55098850ee049978e928345f248f6bccb48ec10c81d1c0413e841d5a395a`; the runtime hash remains `0x2a7d8020300f3be9fb399174fcd6059fdaefbff70b715574937a76d77b6303aa`. Both match the existing manifest. Contract reads and the status API GET succeeded; see `checks/live-verification.json`. The real-page smoke check also loaded contract limits/stats and recorded the telemetry state without assuming availability. Read-only `curl --fail-with-body --silent --show-error --max-time 20` GETs of the two specified live-service URLs succeeded; `checks/broadcast.json` records idle state, null validity and the schedule occurrence.

## Rendered evidence

- `screenshots/mobile-live.png`: actual production export with real reads, 390 × 844 first screen. The filename refers to live service reads, not a live video.
- `screenshots/desktop-live.png`: actual 1440px production page, real reads, full page.
- `screenshots/player-fixture.png`: 390px card with red LIVE badge, keyboard-focused close and a plainly labelled provider fixture.
- `screenshots/break-dialog-fixture.png`: full-precision requested confirmation sentence, mock bag.
- `screenshots/webkit-validation-fixture.png`: WebKit 390px form validation after wallet fixture connection.

The probe also generated disposable screenshots at `test/scratch/taste/shots/`. Runtime sources/artwork/fonts are in `web/` and `dist/`; no production file depends on `.imd/reads/` or scratch evidence.

## Limitations

The descriptor service was idle throughout the real checks. Actual X/YouTube/Twitch video playback, provider authentication/embedding policies, real player controls/captions and availability remain unverified; fixture loading establishes this page's URL construction, sizing, interaction and removal behavior. An external provider can still reject or restrict a valid public ID.

No real signing, passkey creation, physical-phone wallet handoff, screen-reader session or native browser zoom was performed. Text enlargement is explicitly a CSS reflow check, not native zoom. The site has one English dark variant. The unchanged upstream `ox` Tempo browser externalization warning remains in the build; checked local chunks/flows loaded without script or missing-file errors.

The copy's “auto-unlock” describes contract eligibility; cash-out still needs a wallet transaction. The live layer is informational and cannot authorize opening. External RPC/API responses may be stale or unavailable, and the UI preserves unknown/last-read states accordingly.

## Submission integrity

Existing contract source, chain/address configuration, ABIs, Solidity build configuration/dependencies, frontend manifest/lockfile, and both ignore files have no diff. No `.git/`, `.github/`, `.env` or `node_modules/` change is submitted. No submodule, package cache, registry mirror or unnecessary dependency archive is included. Root `dist/` contains only required application/runtime assets. A conservative byte audit of complete changed/new files is below 8,388,608 bytes; the final measured totals are in `checks/bundle.json`. Installation/build/preview instructions and implemented design tokens/components are documented in root README and DESIGN.
