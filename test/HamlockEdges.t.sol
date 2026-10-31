// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Hamlock} from "../src/Hamlock.sol";
import {MockCore} from "./helpers/MockCore.sol";
import {HamlockFixture} from "./helpers/HamlockFixture.sol";
import {HeavyCore, DelegatingProxy} from "./helpers/ExtraCores.sol";

/// @dev Edge-of-domain properties: revert precedence, exact thresholds, pro-rata arithmetic at arbitrary
/// amounts, gas starvation of the core read, and a proxied core like the live deployment.
contract HamlockEdgesTest is HamlockFixture {
    uint256 internal constant WPK = 1139;

    function _absDiff(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a - b : b - a;
    }

    function _bytes4(bytes memory ret) internal pure returns (bytes4 sel) {
        if (ret.length < 4) return bytes4(0);
        assembly {
            sel := mload(add(ret, 32))
        }
    }

    // ------------------------------------------------------------------ lock limits & precedence

    /// forge-config: default.fuzz.runs = 1000
    function testFuzz_lockRevertPrecedence(uint16 km, uint96 valueSeed, bool coreDown, bool hasJar) public {
        uint256 value = bound(valueSeed, 0, 2 ether);
        if (hasJar) _lock(ALICE, 0.01 ether, 5);
        mock.setUnavailable(coreDown);
        uint256 balanceBefore = address(hamlock).balance;
        uint256 lockedBefore = hamlock.totalLocked();

        bytes4 expected;
        if (hasJar) expected = Hamlock.AlreadyHasJar.selector;
        else if (km < 1 || km > 100) expected = Hamlock.BadDistance.selector;
        else if (value < 0.001 ether || value > 1 ether) expected = Hamlock.BadDeposit.selector;
        else if (coreDown) expected = Hamlock.CoreUnavailable.selector;

        vm.prank(ALICE);
        (bool ok, bytes memory ret) = address(hamlock).call{value: value}(abi.encodeCall(Hamlock.lock, (km)));
        if (expected == bytes4(0)) {
            assertTrue(ok);
            Hamlock.Jar memory jar = _jar(ALICE);
            assertEq(jar.amount, value);
            assertEq(jar.km, km);
            assertEq(jar.targetWork, START_WORK + uint256(km) * WPK);
            assertEq(hamlock.totalLocked(), lockedBefore + value);
        } else {
            assertFalse(ok);
            assertEq(_bytes4(ret), expected);
            assertEq(address(hamlock).balance, balanceBefore);
            assertEq(hamlock.totalLocked(), lockedBefore);
        }
    }

    function test_lockRejectedSecondJarEvenAfterDeadline() public {
        _lock(ALICE, 0.1 ether, 1);
        vm.warp(START_TIME + 60 days);
        vm.expectRevert(Hamlock.AlreadyHasJar.selector);
        _lock(ALICE, 0.1 ether, 1);
        // Open first, then a new jar is allowed and gets a fresh deadline.
        _open(ALICE);
        _lock(ALICE, 0.1 ether, 1);
        assertEq(_jar(ALICE).deadline, START_TIME + 60 days + 30 days);
    }

    // ------------------------------------------------------------------ openability thresholds

    /// forge-config: default.fuzz.runs = 1000
    function testFuzz_openOrBreakExactlyOneSucceeds(uint16 kmSeed, uint32 deltaSeed, uint32 dtSeed, bool down)
        public
    {
        uint16 km = uint16(bound(kmSeed, 1, 100));
        _lock(ALICE, 0.5 ether, km);
        _lock(BOB, 0.25 ether, 100);
        uint256 target = uint256(km) * WPK;
        // Concentrate around the thresholds so the boundary is exercised, not only far either side.
        uint256 delta =
            deltaSeed % 2 == 0 ? bound(deltaSeed, target - 2, target + 2) : bound(deltaSeed, 0, 200_000);
        uint256 dt = dtSeed % 2 == 0 ? bound(dtSeed, 30 days - 2, 30 days + 2) : bound(dtSeed, 0, 90 days);
        mock.setWork(uint64(START_WORK + delta));
        mock.setUnavailable(down);
        vm.warp(START_TIME + dt);

        bool ran = !down && delta >= target;
        bool openable = ran || dt >= 30 days;
        assertEq(hamlock.isOpenable(ALICE) ? 1 : 0, openable ? 1 : 0);
        uint256 remaining = down ? target : (delta >= target ? 0 : target - delta);
        assertEq(hamlock.workRemaining(ALICE), remaining);

        if (openable) {
            vm.expectRevert(Hamlock.AlreadyOpenable.selector);
            _break(ALICE);
            uint256 before = ALICE.balance;
            vm.expectEmit(true, false, false, true, address(hamlock));
            emit Opened(ALICE, 0.5 ether, 0, ran, km);
            _open(ALICE);
            assertEq(ALICE.balance - before, 0.5 ether);
            assertEq(hamlock.jarsCompleted(ALICE), ran ? 1 : 0);
            assertEq(hamlock.kmCompleted(ALICE), ran ? km : 0);
            assertEq(hamlock.jarsBroken(ALICE), 0);
        } else {
            vm.expectRevert(Hamlock.StillLocked.selector);
            _open(ALICE);
            uint256 before = ALICE.balance;
            _break(ALICE);
            assertEq(ALICE.balance - before, 0.4 ether);
            assertEq(hamlock.jarsBroken(ALICE), 1);
            assertEq(hamlock.jarsCompleted(ALICE), 0);
            assertEq(hamlock.pendingReward(BOB), 0.1 ether);
        }
        _assertEmpty(ALICE);
        _assertSolvent();
    }

    function test_jarStartedAtNonZeroWorkNeedsItsOwnDistance() public {
        // Work done before the lock never counts towards the jar.
        mock.setWork(1_000_000);
        _lock(ALICE, 0.1 ether, 2);
        mock.setWork(1_000_000 + 2 * 1139 - 1);
        assertFalse(hamlock.isOpenable(ALICE));
        vm.expectRevert(Hamlock.StillLocked.selector);
        _open(ALICE);
        mock.setWork(1_000_000 + 2 * 1139);
        _open(ALICE);
        assertEq(hamlock.kmCompleted(ALICE), 2);
    }

    // ------------------------------------------------------------------ pro-rata arithmetic

    /// forge-config: default.fuzz.runs = 1000
    function testFuzz_penaltySplitsProRataAndIsFullyPayable(uint96 aSeed, uint96 bSeed, uint96 cSeed) public {
        uint256 a = bound(aSeed, 0.001 ether, 1 ether);
        uint256 b = bound(bSeed, 0.001 ether, 1 ether);
        uint256 c = bound(cSeed, 0.001 ether, 1 ether);
        _lock(ALICE, a, 1);
        _lock(BOB, b, 1);
        _lock(CAROL, c, 100);
        uint256 carolBefore = CAROL.balance;
        _break(CAROL);
        uint256 penalty = c * 2000 / 10_000;
        assertEq(CAROL.balance - carolBefore, c - penalty);

        uint256 pa = hamlock.pendingReward(ALICE);
        uint256 pb = hamlock.pendingReward(BOB);
        assertLe(pa + pb, penalty);
        // Each share is the exact pro-rata amount within one wei; together they lose at most two wei.
        assertLe(_absDiff(pa, penalty * a / (a + b)), 1);
        assertLe(_absDiff(pb, penalty * b / (a + b)), 1);
        assertLe(penalty - (pa + pb), 2);

        mock.setWork(START_WORK + 1139);
        uint256 aliceBefore = ALICE.balance;
        uint256 bobBefore = BOB.balance;
        _open(ALICE);
        _open(BOB);
        assertEq(ALICE.balance - aliceBefore, a + pa);
        assertEq(BOB.balance - bobBefore, b + pb);
        assertEq(address(hamlock).balance, penalty - pa - pb);
    }

    /// forge-config: default.fuzz.runs = 1000
    function testFuzz_lateJoinerSharesOnlyLaterPenalties(
        uint96 aSeed,
        uint96 cSeed,
        uint96 dSeed,
        uint96 c2Seed
    ) public {
        uint256 a = bound(aSeed, 0.001 ether, 1 ether);
        uint256 c = bound(cSeed, 0.001 ether, 1 ether);
        uint256 d = bound(dSeed, 0.001 ether, 1 ether);
        uint256 c2 = bound(c2Seed, 0.001 ether, 1 ether);
        _lock(ALICE, a, 100);
        _lock(CAROL, c, 100);
        _break(CAROL);
        uint256 aliceFirst = hamlock.pendingReward(ALICE);
        assertLe(c / 5 - aliceFirst, 1);

        _lock(DAVE, d, 100);
        assertEq(hamlock.pendingReward(DAVE), 0);
        assertEq(hamlock.pendingReward(ALICE), aliceFirst);

        _lock(CAROL, c2, 100);
        _break(CAROL);
        uint256 p2 = c2 / 5;
        uint256 pd = hamlock.pendingReward(DAVE);
        uint256 aliceSecond = hamlock.pendingReward(ALICE) - aliceFirst;
        assertLe(_absDiff(pd, p2 * d / (a + d)), 1);
        assertLe(_absDiff(aliceSecond, p2 * a / (a + d)), 1);
        assertLe(pd + aliceSecond, p2 + 1);
        _assertSolvent();
    }

    /// forge-config: default.fuzz.runs = 1000
    function testFuzz_breakerForfeitsEverythingToRemainingHolder(uint96 aSeed, uint96 bSeed, uint96 cSeed)
        public
    {
        uint256 a = bound(aSeed, 0.001 ether, 1 ether);
        uint256 b = bound(bSeed, 0.001 ether, 1 ether);
        uint256 c = bound(cSeed, 0.001 ether, 1 ether);
        _lock(ALICE, a, 100);
        _lock(BOB, b, 100);
        _lock(CAROL, c, 100);
        _break(CAROL);
        uint256 pa = hamlock.pendingReward(ALICE);
        uint256 pb = hamlock.pendingReward(BOB);

        uint256 bobBefore = BOB.balance;
        vm.expectEmit(true, false, false, true, address(hamlock));
        emit Broken(BOB, b - b / 5, b / 5, pb, false);
        _break(BOB);
        // The breaker receives only 80% of principal: none of the reward it had earned.
        assertEq(BOB.balance - bobBefore, b - b / 5);
        uint256 gained = hamlock.pendingReward(ALICE) - pa;
        assertLe(gained, b / 5 + pb);
        assertLe(b / 5 + pb - gained, 1);
        assertEq(hamlock.totalPenalties(), c / 5 + b / 5 + pb);

        // Alice is now the last holder: everything she is owed is actually in the contract.
        vm.warp(START_TIME + 30 days);
        uint256 owed = a + hamlock.pendingReward(ALICE);
        uint256 aliceBefore = ALICE.balance;
        _open(ALICE);
        assertEq(ALICE.balance - aliceBefore, owed);
        assertLe(address(hamlock).balance, 3);
    }

    /// forge-config: default.fuzz.runs = 500
    function testFuzz_lastBreakerBurnsPenaltyPlusForfeit(uint96 aSeed, uint96 bSeed) public {
        uint256 a = bound(aSeed, 0.001 ether, 1 ether);
        uint256 b = bound(bSeed, 0.001 ether, 1 ether);
        _lock(ALICE, a, 100);
        _lock(BOB, b, 100);
        _break(BOB);
        uint256 pa = hamlock.pendingReward(ALICE);
        uint256 burnBefore = hamlock.BURN().balance;
        uint256 balanceBefore = address(hamlock).balance;
        _break(ALICE);
        uint256 burned = hamlock.BURN().balance - burnBefore;
        assertEq(burned, a / 5 + pa);
        assertEq(hamlock.totalBurned(), burned);
        assertEq(hamlock.totalPenalties(), b / 5 + a / 5 + pa);
        assertEq(balanceBefore - address(hamlock).balance, a + pa);
        assertLe(address(hamlock).balance, 1);
        // The accumulator stays where it was: a burn does not raise anyone's reward.
        _lock(CAROL, 0.5 ether, 1);
        assertEq(hamlock.pendingReward(CAROL), 0);
    }

    function test_openedLastHolderLeavesNoBurnAndNextBreakerBurns() public {
        // Pool empties by opening; the next solo breaker must burn, not credit a phantom pool.
        _lock(ALICE, 0.3 ether, 1);
        _lock(BOB, 0.2 ether, 100);
        _break(BOB);
        mock.setWork(START_WORK + 1139);
        _open(ALICE);
        assertEq(hamlock.totalLocked(), 0);
        uint256 acc = hamlock.accRewardPerWei();
        _lock(CAROL, 0.5 ether, 100);
        uint256 burnBefore = hamlock.BURN().balance;
        _break(CAROL);
        assertEq(hamlock.BURN().balance - burnBefore, 0.1 ether);
        assertEq(hamlock.accRewardPerWei(), acc);
    }

    // ------------------------------------------------------------------ gas starvation of the read

    /// forge-config: default.fuzz.runs = 300
    function testFuzz_gasStarvedBreakCannotBypassOpenableJar(uint32 gasSeed, bool heavy) public {
        Hamlock target = _targetWithCore(heavy);
        vm.prank(ALICE);
        target.lock{value: 0.5 ether}(1);
        vm.prank(BOB);
        target.lock{value: 0.5 ether}(100);
        _setTargetWork(heavy, START_WORK + 1139);
        assertTrue(target.isOpenable(ALICE));

        uint256 gasLimit = bound(gasSeed, 0, 600_000);
        vm.prank(ALICE);
        (bool ok,) = address(target).call{gas: gasLimit}(abi.encodeCall(Hamlock.breakJar, ()));
        // Starving the 200k read frame to make it fail must not make the jar breakable.
        assertFalse(ok);
        assertEq(_targetJarAmount(target, ALICE), 0.5 ether);
        assertEq(target.totalPenalties(), 0);
    }

    /// forge-config: default.fuzz.runs = 300
    function testFuzz_gasStarvedOpenAfterDeadlineAlwaysScores(uint32 gasSeed, bool heavy) public {
        Hamlock target = _targetWithCore(heavy);
        vm.prank(ALICE);
        target.lock{value: 0.5 ether}(3);
        _setTargetWork(heavy, START_WORK + 3 * 1139);
        vm.warp(START_TIME + 30 days);

        uint256 gasLimit = bound(gasSeed, 0, 600_000);
        vm.prank(ALICE);
        (bool ok,) = address(target).call{gas: gasLimit}(abi.encodeCall(Hamlock.open, ()));
        if (ok) {
            // Whoever's gas limit lets the open succeed also lets the read succeed: credit is not lost.
            assertEq(target.jarsCompleted(ALICE), 1);
            assertEq(target.kmCompleted(ALICE), 3);
        } else {
            assertEq(_targetJarAmount(target, ALICE), 0.5 ether);
        }
    }

    function test_heavyCoreWithinBudgetStillReadsAndOverBudgetFallsBackToDeadline() public {
        HeavyCore heavy = new HeavyCore(START_WORK, 150_000);
        Hamlock target = new Hamlock(address(heavy));
        (bool ok, uint64 work) = target.currentWork();
        assertTrue(ok);
        assertEq(work, START_WORK);
        vm.prank(ALICE);
        target.lock{value: 0.2 ether}(1);
        heavy.setWork(START_WORK + 1139);
        assertTrue(target.isOpenable(ALICE));

        heavy.setBurnGas(250_000);
        (ok, work) = target.currentWork();
        assertFalse(ok);
        assertFalse(target.isOpenable(ALICE));
        vm.expectRevert(Hamlock.StillLocked.selector);
        vm.prank(ALICE);
        target.open();
        vm.warp(START_TIME + 30 days);
        vm.prank(ALICE);
        target.open();
        // The distance was really run, but the over-budget core cannot prove it: no credit given.
        assertEq(target.jarsCompleted(ALICE), 0);
        assertEq(ALICE.balance, 100 ether);
    }

    // ------------------------------------------------------------------ proxied core

    function test_readsThroughDelegatingProxyLikeLiveCore() public {
        MockCore impl = new MockCore();
        DelegatingProxy proxy = new DelegatingProxy(address(impl));
        MockCore viaProxy = MockCore(address(proxy));
        viaProxy.setWork(77_777);
        Hamlock target = new Hamlock(address(proxy));
        (bool ok, uint64 work) = target.currentWork();
        assertTrue(ok);
        assertEq(work, 77_777);
        vm.prank(ALICE);
        target.lock{value: 0.1 ether}(1);
        viaProxy.setWork(77_777 + 1138);
        assertFalse(target.isOpenable(ALICE));
        viaProxy.setWork(77_777 + 1139);
        vm.prank(ALICE);
        target.open();
        assertEq(target.kmCompleted(ALICE), 1);
        // A proxy whose implementation starts reverting behaves like an outage.
        vm.prank(BOB);
        target.lock{value: 0.1 ether}(1);
        viaProxy.setUnavailable(true);
        (ok,) = target.currentWork();
        assertFalse(ok);
        vm.warp(START_TIME + 30 days);
        vm.prank(BOB);
        target.open();
        assertEq(target.jarsCompleted(BOB), 0);
    }

    // ------------------------------------------------------------------ helpers

    HeavyCore internal heavyCore;

    function _targetWithCore(bool heavy) internal returns (Hamlock) {
        if (heavy) {
            heavyCore = new HeavyCore(START_WORK, 150_000);
            return new Hamlock(address(heavyCore));
        }
        return hamlock;
    }

    function _setTargetWork(bool heavy, uint64 work) internal {
        if (heavy) heavyCore.setWork(work);
        else mock.setWork(work);
    }

    function _targetJarAmount(Hamlock target, address owner) internal view returns (uint256 amount) {
        (amount,,,,,) = target.jars(owner);
    }
}
