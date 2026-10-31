# HAMLOCK

HAMLOCK locks Sepolia ETH until Squeektoshi has run the chosen distance, measured by Squeekchain's
on-chain `cumulativeWork`. A jar also opens after 30 days, even if SqueekCore is unavailable.
Breaking early forfeits 20% of principal and all earned rewards to the remaining holders.

The deployable application is **`src/Hamlock.sol:Hamlock`**, compiled with **Solidity 0.8.28**.
It is one file, with no Solidity dependencies, linked libraries, token, owner, administrator,
pause, upgrade, rescue function or initialization transaction. The browser client is in `web/`, with the finished static export in `dist/`.

## Website (site label: hamlock)

The contract is already live on **Ethereum Sepolia, chain ID 11155111**, at
[`0xc17b08994b70b468aa30e4e3d73edf9d65727302`](https://sepolia.etherscan.io/address/0xc17b08994b70b468aa30e4e3d73edf9d65727302).
The website connects to that deployment directly from the browser. This website contribution does not deploy or publish anything. `dist/` is the ready-to-pin IPFS export; the hosting plane publishes it after handoff.

Use Node.js 22.12 or newer and npm. From the repository root:

```sh
cd web
npm ci
npm run typecheck
npm run build
npm run preview
```

Open the preview URL printed by Vite (normally `http://localhost:4173`). For development use `npm run dev`. The build writes **root `dist/`**, including `index.html`, fonts, favicon, share card, artwork and wallet marks. Vite uses `base: './'`, assets are relative, and navigation uses anchors, so the page works at an IPFS gateway subpath with no rewrite server. Serve the directory over HTTP(S); do not double-click `index.html` as a `file:` URL. No private keys, environment files, relay, project ID or backend are required.

The independent frontend manifest and exact npm lockfile are `web/package.json` and `web/package-lock.json`. Existing Solidity configuration and dependencies are unchanged. `web/.gitignore` has an explicit zero-byte Git budget for `web/node_modules/**` and `web/.vite/**`; source, manifests, lockfile and root `dist/` are retained. Package caches and browser/system dependencies used for verification stay outside the submission.

### Data and wallet behavior

- Reads work without a wallet through PublicNode, then the pinned ethpandaops and Sentio Sepolia fallbacks. Contract constants provide form limits, work conversion per chosen km, deadline duration and penalty percentages. Unknown or unavailable readings are labelled; no demo balances or rankings ship.
- Injected wallets are discovered by EIP-6963 and shown by name. The wallet sheet also supports Coinbase Wallet/Smart Wallet, and mobile links into MetaMask, Coinbase, Rabby and Phantom. The header offers switch/add Sepolia and disconnect. Wallet signing is required only for `lock`, `open`, and `breakJar`.
- Before transactions, the client checks the chain ID and the verified runtime code hash, simulates the call, requests the wallet signature, and follows the receipt. The ABI was generated from the pinned source with Foundry/Solidity 0.8.28; its canonical Keccak hash exactly matches `web/deployment.json`. Compiled runtime, including the immutable core address, also exactly matched live bytecode.
- Chain state, jar data and Squeekchain status refresh every 15 seconds while the page is active. The API's freshness and timestamps are checked. Stale or failed telemetry removes the live layer; settled contract data remains. Only `isOpenable` authorizes opening. A deadline opening still works when the core/API is unavailable.
- The leaderboard scans `Opened` events from block **12036187**, keeps only `hamsterRanIt = true`, and reads `kmCompleted`, `jarsCompleted`, and `jarsBroken` for those wallets. It ranks km, then completed jars; broken jars appear as “Paper hands.” Scans adapt their block range to provider limits and rescan a short tail for reorgs. No complete ranking is shown while a scan is incomplete.
- All consequential ETH arithmetic uses `bigint`; the break dialog displays wei-exact values and rechecks the pending reward before signing. Network fees are excluded and rewards can still change before mining. The requested approximate active-night distance and wheel calibration are explanatory facts supplied by the brief; they are not invented live readings.
- Share on X appears for an active or just-confirmed jar and uses its distance plus the current site URL. The unknown final IPFS address is never guessed.

### Website verification

After building, browser validation can be rerun from `web/`:

```sh
npx playwright install --with-deps chromium webkit
npm run validate
npm run verify:live -- --out artifacts/live-verification.json
```

The first command installs verification browsers and their host dependencies; it can require system package permissions. `validate` serves the actual export under `/preview/`, closes its own server/browsers, and writes generated evidence under root `test/scratch/interactions/` and `artifacts/`. Mock transactions never reach a real chain; a separate smoke check reads the live services. `verify:live` is read-only, checks the ABI/runtime hashes and contract/API responses, and interprets `--out` relative to the repository root. It does not sign, send or deploy.

Actual final results on 2026-10-31:

| Check                               | Result                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| `npm run typecheck`                 | Passed, exit 0                                                                 |
| `npm run build`                     | Passed, exit 0; static export generated                                        |
| `npm run validate`                  | **21/21 passed**, exit 0; Chromium and WebKit                                  |
| Pinned `taste.mjs` production probe | **16/16 passed**, exit 0; 320, 390 and 1440px                                  |
| axe WCAG A/AA scans                 | No violations in disconnected page, wallet dialog, active jar and break dialog |
| Live Sepolia and Squeekchain reads  | Passed; ABI hash and compiled runtime match verified deployment                |

WebKit initially lacked libraries/graphics support. Verification succeeded after extracting the required libraries outside the repository and enabling software EGL. The supplied managed browser tool itself could not initialize because its cache was read-only; the rendered evidence comes from local Playwright. The build reports an upstream `ox` Tempo `node:worker_threads` externalization warning; the EVM site rendered without script or missing-local-resource errors in both engines.

No real wallet transaction, Coinbase passkey creation, physical-phone deep link, screen-reader session or native browser zoom was performed. These limits are separate from the passing mock transaction, keyboard, reflow, contrast and accessibility checks. Public RPC/API availability remains external to the static site.

[Detailed review and limitations](docs/WEBSITE_VALIDATION.md), [recorded results](docs/checks/interactions.json), [design system](DESIGN.md), [mobile screenshot](docs/screenshots/mobile-live.png), [desktop screenshot](docs/screenshots/desktop-live.png).

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
