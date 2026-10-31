# HAMLOCK

your bags. his legs.

HAMLOCK locks Sepolia ETH until Squeektoshi runs the selected distance, measured by Squeekchain's on-chain work counter. A bag becomes openable after 30 days even if SqueekCore is unavailable. Breaking early forfeits 20% of principal and all earned rewards to remaining holders, or burns them if nobody remains.

The browser source is in `web/`. The finished static site is in root `dist/`. The existing contract, ABI, address, network configuration, package manifest and lockfile are unchanged by this update.

## Install, preview and rebuild

Use Node.js 22.12 or newer and npm. From the repository root:

```sh
cd web
npm ci
npm run typecheck
npm run build
npm run preview
```

Open the local URL printed by Vite. Use `npm run dev` for development. `npm run build` replaces root `dist/`; it contains `index.html`, the JavaScript/CSS chunks, local fonts, hamster artwork, wallet marks, favicon and share image. The existing `web/package.json` and `web/package-lock.json` provide the exact frontend dependencies. No new dependency is required for this update.

Vite's existing `base: './'` produces relative asset URLs. Navigation uses anchors. Serve `dist/` over HTTP(S), including at a gateway subpath; no application server or route rewriting is needed. Hosting/pinning happens after handoff. No deployment or publication command is part of this contribution.

Generated dependencies and caches are excluded from the submission. The unchanged `web/.gitignore` budgets **0 Git bytes** for `web/node_modules/**` and `web/.vite/**`; the source, manifest, lockfile and root export remain deliverables. Verification browsers and package caches were kept outside the repository. No npm archives or offline registry are needed.

## Live card

The single `LIVE_URL` constant at the top of [`web/src/live.ts`](web/src/live.ts) holds both endpoint URLs:

- Descriptor: `https://hamlock-live.jubilee-registry.workers.dev/current`
- Schedule: `https://hamlock-live.jubilee-registry.workers.dev/schedule`

Both are fetched immediately when the page is visible, then every 30 seconds. Hiding the page stops polling and aborts in-flight requests; returning refreshes immediately. Each request has a 10-second timeout. Schedule failure is independent of descriptor failure.

A schema-v2 descriptor is live only with `state: "live"` and a future `validUntil`. The red LIVE badge and WATCH LIVE control are separate from the wheel's API-derived SPINNING / IDLE and rpm readouts. Watching replaces the pixel art with a 16:9 iframe; closing restores the art and button focus. Expiry, an ending broadcast, a failed poll or a changed provider removes the old player. A changed provider needs a fresh click.

Only validated X broadcast IDs, YouTube public IDs and Twitch channel names can produce an iframe. The code fixes the provider origins and parameters, including Twitch's current hostname as `parent`; arbitrary feed URLs are never embedded. Unsupported/invalid playback falls back to `https://x.com/squeekchain`. Descriptor errors also offer that fallback. Off air, the card shows `schedule.occurrence.startAt` as local 24-hour time, with the full local date available on the time element, plus “follow on x.” Missing schedule data reads “tbd.” No future occurrence is invented when the service supplies an earlier start.

## Contract and wallet behavior

The live deployment remains **Ethereum Sepolia, chain ID 11155111**, at [`0xc17b08994b70b468aa30e4e3d73edf9d65727302`](https://sepolia.etherscan.io/address/0xc17b08994b70b468aa30e4e3d73edf9d65727302). The Solidity source remains `src/Hamlock.sol:Hamlock`, compiled with Solidity 0.8.28. Nothing in this update changes its economics or permissions.

- PublicNode and the existing ethpandaops/Sentio RPC fallbacks provide reads without a wallet. Limits, work conversion, deadline duration, penalty, totals, jar state and rankings come from the contract. The requested “~10 km on a good night” is explanatory copy supplied in the brief, not a live measurement.
- Wallets use the existing EIP-6963 extension discovery, Coinbase Wallet/Smart Wallet, and mobile links into MetaMask, Coinbase, Rabby and Phantom. Switch/add Sepolia and disconnect remain available. No private keys, environment files, relay or project ID are required.
- Transactions retain deployment verification, simulation, wallet confirmation, receipt/event checks and refresh. ETH arithmetic and break refunds remain wei-exact `bigint`. A changed reward requires renewed confirmation. Gas is additional, and final rewards can change before mining.
- Contract `isOpenable` decides when CASH OUT is available. “Auto-unlock” means eligibility after the contract deadline; the visitor still sends the cash-out transaction. Live telemetry or video never unlocks a bag.
- Contract/jar/telemetry refresh behavior remains 15 seconds while active. Stale telemetry becomes unknown and removes the live progress layer. Progress now converts work with the contract's `WORK_PER_KM`; the live portion in the copy is the additional distance not yet settled.
- Rankings still derive from qualifying `Opened` events from deployment block **12036187**, then contract scores. Sharing uses the bag's km, the exact requested text and the visitor's current site URL. No demo balances, jars or rankings ship.

## Validation

After building, from `web/`:

```sh
npx playwright install --with-deps chromium webkit
npm run validate
npm run verify:live -- --out docs/checks/live-verification.json
```

`validate` serves the actual export under `/preview/`, manages and closes its server/browsers, intercepts test RPC/API/video responses, and records results in `docs/checks/interactions.json`. Screenshots go to the disposable `test/scratch/interactions/`. Its one real-service smoke check is read-only. Use `npm run validate -- --offline` to omit that external smoke check; the remaining tests work with intercepted service responses. No test signs or broadcasts a real transaction. Regenerate the optional share artwork with `npm run make:og`, then rebuild.

Actual local results on **2026-10-31**:

| Check                               | Result                                                                                             |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                 | Passed, exit 0                                                                                     |
| `npm run build`                     | Passed, exit 0; root `dist/` generated                                                             |
| `npm run validate`                  | **33/33 passed**, exit 0; Chromium and WebKit                                                      |
| Pinned production `taste.mjs` probe | **14/16** raw checks; the two flags are the brief's exact uppercase/status and multi-sentence copy |
| axe WCAG A/AA checks                | No violations in disconnected, wallet, bag, break, live-art and player-fixture states              |
| 390 × 844 first screen              | Product, distance, amount and LOCK IT visible; button bottom about 702px                           |
| New badge contrast                  | LIVE **6.00:1**; OFF AIR **6.51:1**, from rendered colors                                          |
| Live Sepolia verification           | Canonical ABI hash and runtime hash match the pinned deployment; reads passed                      |
| Real descriptor and schedule GETs   | Passed; descriptor was idle, so real video playback was not observed                               |

The supplied managed browser tool reported that Chrome was missing. Local Playwright supplied the rendered evidence. WebKit initially lacked libraries/EGL support; temporary libraries and a software EGL configuration outside the repository allowed the final run. The build retains the upstream `ox` Tempo `node:worker_threads` externalization warning. No script errors or missing local resources were found in the checked flows.

Limits: actual live video, provider controls/captions inside a real cross-origin stream, real wallet signing, Coinbase passkey creation, physical-phone app switching, screen-reader use and native browser zoom were not tested. Responsive reflow and independent 200% text enlargement were tested. The final real-service smoke check reported IDLE, and the separate read-only API request succeeded. Public service availability remains external to the static export.

See [six-domain review and limitations](docs/WEBSITE_VALIDATION.md), [interaction results](docs/checks/interactions.json), [probe results](docs/checks/taste.json), [broadcast responses](docs/checks/broadcast.json), [design system](DESIGN.md), [mobile first screen](docs/screenshots/mobile-live.png), [desktop page](docs/screenshots/desktop-live.png), and [player fixture](docs/screenshots/player-fixture.png). The latter deliberately shows fixture content, not a real broadcast.

The original contract build/review and deployment handoff below is retained as project history. The live address above supersedes its predeployment handoff status.

**Independent security review is requested before deployment.** See
[the review request](docs/SECURITY_REVIEW.md). Local tests are not an independent audit.

## Build and test

With Foundry and Solidity 0.8.28 installed, run from the repository root:

```sh
forge build
FOUNDRY_FUZZ_SEED=0x501449ff1297530ccba3524eca65b8218fd0e7363e3f6acccfab5407954e9e64 forge test
forge fmt --check
```

All source, test helpers and mock contracts are ordinary project files. There is no dependency
installation step, fork, RPC, environment lookup in tests, FFI, or filesystem cheatcode. Once the
pinned compiler is installed, verification can run without network access. `foundry.toml` uses
the Cancun EVM, optimizer enabled with 200 runs, and `bytecode_hash = "none"`.

Unit tests cover bounds, one jar per wallet, exact work/deadline boundaries, scores, all requested
reward examples, rounded entry debts, dust, repeated rounds, ETH transfer failures and callback
reentrancy into all three entry points. Adversarial core tests include reverts, absent code,
malformed ABI, attempted storage writes, gas exhaustion and oversized return/revert data.
Deployment tests rehearse the supplied argument through a factory on an empty chain and check
code size, absent privileged entry points and forbidden runtime opcodes.

The stateful invariant uses eight wallets and randomized deposits, opens, breaks, core progress,
core outages, time changes and forced surplus. It checks every active principal plus pending reward
is backed by ETH, tracks actual payouts and burns, reconciles jar counts and scores, and settles
all remaining jars after the deadline at the end of each run. Defaults: 512 cases per fuzz test,
256 invariant runs of 128 actions each, with unexpected reverts failing the run.

## Deployment handoff

| Parameter                        | Value                                        |
| -------------------------------- | -------------------------------------------- |
| Network                          | Ethereum Sepolia only                        |
| Chain ID                         | `11155111`                                   |
| Solidity contract                | `Hamlock`                                    |
| Constructor                      | `constructor(address core_)`, nonpayable     |
| `core_`                          | `0x980b4424c007caf7a1f3670b48c8eaef7ebc3d44` |
| Deployment ETH                   | `0`                                          |
| Owner/admin argument             | None                                         |
| Initialization / library linking | None                                         |

The dependency is the **SqueekCore proxy**, not its implementation. Its address comes from the
approved brief. The [official API](https://api.squeekchain.com/v1/core) was checked during this work
and reported the same `identities.core` and chain ID. The API is informational: HAMLOCK never
uses HTTP data or writes to SqueekCore. This check is not live-chain bytecode or gas verification.

The constructor validates a nonzero address, stores it immutably, and makes no external call or
code-existence check, so factory deployment works on the empty-chain rehearsal. The constructor
does not enforce chain ID; **the deployment operator must enforce Sepolia and the exact argument**.
No deployment, signing, transaction broadcast or launch manifest is included in this assignment.

Before release, the deployment operator must obtain the independent review, reconcile the final
source/compiler settings/constructor argument with the manifest, and verify live Sepolia code and
the full `state()` ABI at the proxy. Simulate `currentWork()` and a lock using the finalized bytecode
to confirm the core read fits the documented gas budget. Record the actual deployed address and
verify source on the Sepolia explorer. Never substitute a guessed HAMLOCK address in integrations.

## Rules and interface

| Setting                   | Value                                                       |
| ------------------------- | ----------------------------------------------------------- |
| Distance                  | Integer kilometres, `1` through `100`, inclusive            |
| Work per kilometre        | `1139` wheel turns (one turn is approximately 0.878 metres) |
| Deposit                   | `0.001` through `1` Sepolia ETH, inclusive                  |
| Maximum duration          | `30 days` from the lock transaction's timestamp             |
| Early penalty             | `2000 / 10000` of principal, rounded down                   |
| Reward scale              | `1e24`                                                      |
| Core read gas budget      | `200000` gas for the isolated read frame                    |
| Empty-pool burn recipient | `0x000000000000000000000000000000000000dEaD`                |

- `lock(uint16 km)` is payable and creates one active jar for the caller. Target work is the current
  cumulative work plus `km * 1139`. Closing a jar permits a fresh lock; no top-ups or jar transfers.
- `open()` returns principal plus pending rewards when work reaches the target or the deadline
  passes. `kmCompleted` and `jarsCompleted` increase only when a successful core read at opening
  reaches the target, including when opening after the deadline. Expiry alone earns no score.
- `breakJar()` is available only while the jar is not openable. It returns principal minus the
  rounded penalty, forfeits all pending rewards, and increments `jarsBroken`. The breaker is removed
  before distributing its penalty and forfeiture by the other jars' principal. If no principal
  remains, that sum is sent to the burn address.
- `pendingReward(address)` returns rewards in wei, excluding principal.
- `isOpenable(address)` returns false for an absent jar. At the deadline it returns true without
  reading the core. Before the deadline it requires a successful read reaching the target.
- `workRemaining(address)` returns **wheel turns**, not kilometres or time: zero for an absent or
  reached jar, full original distance on a failed core read, otherwise target minus current work.
  It clamps to full distance if the core regresses below the starting value. Deadline expiry does
  not change this distance reading.
- `currentWork()` returns **`(bool ok, uint64 cumulativeWork)`**. Failure is `(false, 0)`;
  `(true, 0)` is a valid reading. This tuple makes failure distinguishable from zero work.

`jars(address)` exposes `(uint128 amount, uint64 startWork, uint64 targetWork, uint64 deadline,
uint16 km, uint256 rewardDebt)`. `amount == 0` means absent. Global counters are `totalLocked`
(principal only), `activeJars`, `accRewardPerWei`, `totalPenalties` and `totalBurned`. `totalPenalties`
includes forfeited rewards recycled between holders, so it can count the same original ETH more
than once; it is not a measure of unique revenue. Rewards never compound principal weights.

Events are `Locked(owner indexed, amount, km, startWork, targetWork, deadline)`,
`Opened(owner indexed, amount, reward, hamsterRanIt, km)`, and
`Broken(owner indexed, refund, penalty, forfeited, burned)`. The last field of `Broken` is a **bool**;
when true, the amount burned is `penalty + forfeited`.

The specified custom errors describe normal failures. Additional defensive errors are `BadCore`
for a zero constructor argument, `WorkOverflow` and `DeadlineOverflow` for values that do not fit
the stored `uint64` fields, `ReentrantCall` for callbacks into mutating entry points, and `OnlySelf`
for direct access to the internal read trampoline.

## Accounting and dependency assumptions

Entry debt is `ceil(amount * accRewardPerWei / 1e24)`. Claimable reward is
`max(floor(amount * accRewardPerWei / 1e24) - rewardDebt, 0)`. Distributions increase the accumulator
by `floor(toShare * 1e24 / totalLocked)` **after** removing the breaker. Rounding always favors the
contract's reserves. A late joiner cannot claim an earlier fractional reward; rounding can cost a
jar less than two wei relative to its exact accumulated-index entitlement. Distribution rounding
can leave additional dust, which depends on pool size. Dust is neither redistributed nor swept.
The accumulator is not reset when the pool empties.

For a jar with principal `a` joining at index `I0`, its pending reward is at most
`a * (I - I0) / 1e24`. Each index increment allocates at most the penalty plus forfeiture received.
Exiting pays or recycles only the rounded pending amount, leaving any difference as backing dust.
Thus deposits plus all pending rewards remain covered. This argument and its assumptions are
review targets, and are exercised by both churn fuzzing and the stateful invariant.

SqueekCore is an external upgradeable dependency. HAMLOCK trusts its ABI and monotonic work counter;
it cannot verify physical hamster activity or prevent a core upgrade from reporting false progress.
The `paused` field is not an independent lock condition: a valid cumulative work value still counts.
A failed read blocks new locks and distance-based openings, allows early breaks, and cannot block
the timeout. Work completion is evaluated when opening; no historical completion is cached.

`readCoreWork()` is a self-only view helper. The internal `try/catch` calls this helper in a bounded
STATICCALL frame, so decoding failures happen inside the caught call rather than in its caller.
This follows the [Solidity 0.8.28 try/catch semantics](https://docs.soliditylang.org/en/v0.8.28/control-structures.html#try-catch).
The 200000 gas cap also contains a gas-exhausting dependency. A future expensive core upgrade could
be treated as unavailable; users retain the 30-day exit. Transactions still need sufficient total
gas, and ETH recipients must accept payment.

All three mutating entry points share one reentrancy guard. ETH sends use `call`; failed payments
revert with `TransferFailed` and restore the complete operation. A rejecting smart wallet blocks
only its own withdrawal and must change its receiving behavior to retry. There is no alternate
recipient or recovery administrator. Plain ETH transfers are rejected; unavoidable ETH and rounding
dust remain in the contract with no claim or sweep path.

## After launch

There are no setters, admin keys, keepers, funding obligations, or periodic settlement calls.
Users pay gas to open or break their own jars; neither distance completion nor expiry sends ETH
automatically. Openable but unclaimed jars continue earning penalties until closed. Limits apply
per wallet, not per person. Rewards depend on transaction ordering and current principal, not elapsed
time or kilometres; a user entering before a visible break participates in it. No reward is promised.

The operator should publish the reviewed deployment and monitor SqueekCore upgrades, availability
and the read gas requirement. Integrations should show the chain, deposit bounds, exact deadline,
penalty/forfeiture, pending rewards and core availability. During outages they should offer the
deadline exit and explain the cost of an early break. HAMLOCK itself has no mechanism to change
the core address, economics, gas cap, or implementation after deployment.
