# Independent security review request

**To the IdentityMD release coordinator: please assign an independent Solidity security reviewer
before deploying HAMLOCK.** The implementer's tests and notes below are supporting evidence, not
an independent audit or approval to release. Review is pending; no transaction has been sent.

The scope is `src/Hamlock.sol`, `foundry.toml`, the delivered tests, this handoff and the final
deployment manifest supplied by the separate launch step. There is one application, `Hamlock`,
with nonpayable constructor argument `0x980b4424c007caf7a1f3670b48c8eaef7ebc3d44`, for Sepolia chain
ID `11155111`. No owner, token, proxy, mutable dependency, initialization call or library link is
intended. The source's interface is only for reading the external SqueekCore proxy.

Please independently examine:

1. **Conservation and rounding.** Prove that the sum of principal and every pending reward is
   covered. Attack the rounded-up entry debt, the rounded-down accumulator increment and payout,
   the pending-reward clamp, repeated lock/break/open cycles, changing denominators, last-holder
   burns, forfeiture redistribution and an empty pool with an existing accumulator. Verify that
   neither a late joiner nor a breaker can collect historical rewards it does not own.
2. **Deadline liveness and scoring.** Check one second/turn before, at and beyond the thresholds.
   Verify the valve works with reverts, absent bytecode, invalid ABI, excessive return/revert data
   and gas exhaustion, and that timeout does not award distance credit without a valid reading.
   Examine the self-only STATICCALL helper and the fixed 200000 gas budget.
3. **Custody and callbacks.** Attack all mutating entry points from both payout paths; inspect
   checks/effects/interactions, reward and score rollback on receiver failure, and burn rollback
   when the later refund fails. Confirm there is no privileged recovery or redirect path.
4. **Deployment and dependency.** Verify the supplied proxy on live Sepolia, its eight-field ABI,
   monotonic-work assumption and read cost against the finalized artifact. Reconcile constructor
   argument, compiler version/settings, runtime size, bytecode and final manifest. The constructor
   intentionally does not query the core or enforce a chain ID. The deployer must enforce Sepolia.
5. **Test independence and economic behavior.** Review the tests critically, reproduce the required
   fuzz seed, and seek failing sequences outside the mocks. Consider transaction ordering, wallets
   with multiple addresses, a malicious/upgraded core, rounding dust and receivers that reject ETH.
   Funds remain owed to a rejecting wallet, but no third party can make that wallet accept ETH.

The local test suite includes unit/fuzz examples, callback attackers, malformed/core-outage mocks,
a factory deployment rehearsal, and an eight-wallet stateful solvency/conservation invariant with
post-run timeout settlement. All tests are local and deterministic with the supplied seed; there
is no live-chain fork in acceptance tests. No Slither, Mythril or independent audit result is claimed.

Known design assumptions to confirm with the release coordinator: trusting the external core's
progress and upgrades; reward participation by any active principal including expired jars; 30-day
timestamp-based timeout; fixed read gas cap; direct payment only to the jar owner; no rescue of
forced ETH or rounding dust; no owner or incident pause.

The review report should identify the exact source/artifact revision, tests/tools used, concrete
failing inputs for findings, severity, repairs and retest results, and unresolved operational
assumptions. Release should follow independent review and resolution of material findings. The
deployment service, not this assignment, supplies the manifest, signs, broadcasts and records the
deployed address; users remain responsible for their own lock/open/break transactions afterward.
