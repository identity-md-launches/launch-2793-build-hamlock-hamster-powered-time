// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Hamlock} from "../src/Hamlock.sol";
import {HamlockFixture} from "./helpers/HamlockFixture.sol";

contract HamlockRewardsTest is HamlockFixture {
    function test_breakPaysEightyPercentAndSplitsPenaltyProRata() public {
        _lock(ALICE, 0.3 ether, 1);
        _lock(BOB, 0.1 ether, 1);
        _lock(CAROL, 0.5 ether, 100);
        vm.expectEmit(true, false, false, true, address(hamlock));
        emit Broken(CAROL, 0.4 ether, 0.1 ether, 0, false);
        _break(CAROL);
        assertEq(CAROL.balance, 99.9 ether);
        assertEq(hamlock.pendingReward(ALICE), 0.075 ether);
        assertEq(hamlock.pendingReward(BOB), 0.025 ether);
        assertEq(hamlock.totalLocked(), 0.4 ether);
        assertEq(hamlock.activeJars(), 2);
        assertEq(hamlock.totalPenalties(), 0.1 ether);
        assertEq(hamlock.totalBurned(), 0);
        assertEq(hamlock.jarsBroken(CAROL), 1);
        _assertEmpty(CAROL);
        _assertSolvent();

        mock.setWork(START_WORK + 1139);
        vm.expectEmit(true, false, false, true, address(hamlock));
        emit Opened(ALICE, 0.3 ether, 0.075 ether, true, 1);
        _open(ALICE);
        _open(BOB);
        assertEq(ALICE.balance, 100.075 ether);
        assertEq(BOB.balance, 100.025 ether);
        assertEq(address(hamlock).balance, 0);
    }

    function test_lateJoinerReceivesOnlyLaterPenalties() public {
        _lock(ALICE, 0.3 ether, 10);
        _lock(BOB, 0.1 ether, 10);
        _lock(CAROL, 0.5 ether, 10);
        _break(CAROL);
        _lock(DAVE, 0.1 ether, 10);
        assertEq(_jar(DAVE).rewardDebt, 0.025 ether);
        assertEq(hamlock.pendingReward(DAVE), 0);
        assertEq(hamlock.pendingReward(ALICE), 0.075 ether);
        _lock(CAROL, 0.5 ether, 10);
        _break(CAROL);
        assertEq(hamlock.pendingReward(ALICE), 0.135 ether);
        assertEq(hamlock.pendingReward(BOB), 0.045 ether);
        assertEq(hamlock.pendingReward(DAVE), 0.02 ether);
        _assertSolvent();
    }

    function test_breakerForfeitsEarnedRewardsToOtherHolders() public {
        _lock(ALICE, 0.3 ether, 1);
        _lock(BOB, 0.1 ether, 1);
        _lock(CAROL, 0.5 ether, 1);
        _break(CAROL);
        vm.expectEmit(true, false, false, true, address(hamlock));
        emit Broken(BOB, 0.08 ether, 0.02 ether, 0.025 ether, false);
        _break(BOB);
        assertEq(BOB.balance, 99.98 ether);
        assertEq(hamlock.pendingReward(ALICE), 0.12 ether);
        assertEq(hamlock.totalPenalties(), 0.145 ether);
        assertEq(hamlock.totalLocked(), 0.3 ether);
        assertEq(hamlock.activeJars(), 1);
        _assertEmpty(BOB);
        _assertSolvent();
        mock.setWork(START_WORK + 1139);
        _open(ALICE);
        assertEq(ALICE.balance, 100.12 ether);
        assertEq(address(hamlock).balance, 0);
    }

    function test_lastHolderBurnsPenaltyAndForfeitedReward() public {
        _lock(ALICE, 0.5 ether, 1);
        _lock(BOB, 0.5 ether, 1);
        _break(BOB);
        assertEq(hamlock.pendingReward(ALICE), 0.1 ether);
        uint256 burnBefore = hamlock.BURN().balance;
        vm.expectEmit(true, false, false, true, address(hamlock));
        emit Broken(ALICE, 0.4 ether, 0.1 ether, 0.1 ether, true);
        _break(ALICE);
        assertEq(hamlock.BURN().balance - burnBefore, 0.2 ether);
        assertEq(hamlock.totalBurned(), 0.2 ether);
        assertEq(hamlock.totalPenalties(), 0.3 ether);
        assertEq(ALICE.balance, 99.9 ether);
        assertEq(BOB.balance, 99.9 ether);
        assertEq(hamlock.totalLocked(), 0);
        assertEq(hamlock.activeJars(), 0);
        assertEq(address(hamlock).balance, 0);
    }

    function test_singleJarBurnAndNoDoubleBreak() public {
        uint256 burnBefore = hamlock.BURN().balance;
        _lock(ALICE, 0.5 ether, 1);
        _break(ALICE);
        assertEq(hamlock.BURN().balance - burnBefore, 0.1 ether);
        assertEq(hamlock.totalBurned(), 0.1 ether);
        assertEq(hamlock.accRewardPerWei(), 0);
        vm.expectRevert(Hamlock.NoJar.selector);
        _break(ALICE);
        assertEq(hamlock.jarsBroken(ALICE), 1);
    }

    function test_openableButUnclaimedJarStillSharesPenalties() public {
        _lock(ALICE, 0.3 ether, 1);
        _lock(BOB, 0.5 ether, 100);
        mock.setWork(START_WORK + 1139);
        assertTrue(hamlock.isOpenable(ALICE));
        _break(BOB);
        // A repeating third leaves at most one wei undistributed.
        assertEq(hamlock.pendingReward(ALICE), 0.1 ether - 1);
        _open(ALICE);
        assertEq(address(hamlock).balance, 1);
    }

    function test_expiredJarStillSharesAndGetsRewardsDuringCoreOutage() public {
        _lock(ALICE, 0.1 ether, 100);
        vm.warp(START_TIME + 1 days);
        _lock(BOB, 0.5 ether, 100);
        vm.warp(START_TIME + 30 days);
        mock.setUnavailable(true);
        _break(BOB);
        assertEq(hamlock.pendingReward(ALICE), 0.1 ether);
        _open(ALICE);
        assertEq(ALICE.balance, 100.1 ether);
        assertEq(hamlock.jarsCompleted(ALICE), 0);
        assertEq(address(hamlock).balance, 0);
    }

    function test_roundsEntryDebtUpAndHandlesDebtAboveAccrued() public {
        _lock(ALICE, 0.3 ether + 1, 1);
        _lock(BOB, 0.1 ether, 1);
        _break(BOB);
        uint256 index = hamlock.accRewardPerWei();
        uint256 amount = 0.001 ether + 1;
        assertTrue(amount * index % 1e24 != 0);
        _lock(CAROL, amount, 1);
        assertEq(_jar(CAROL).rewardDebt, amount * index / 1e24 + 1);
        assertEq(hamlock.pendingReward(CAROL), 0);
        // Exit immediately on distance: no historical fractional reward can be taken.
        mock.setWork(START_WORK + 1139);
        _open(CAROL);
        assertEq(CAROL.balance, 100 ether);
        _open(ALICE);
        _assertSolvent();
    }

    function test_oldAccumulatorDoesNotRewardNewRoundAfterAllJarsLeave() public {
        _lock(ALICE, 0.3 ether + 1, 1);
        _lock(BOB, 0.5 ether, 1);
        _break(BOB);
        mock.setWork(START_WORK + 1139);
        _open(ALICE);
        uint256 dust = address(hamlock).balance;
        uint256 index = hamlock.accRewardPerWei();
        assertTrue(index > 0);
        _lock(CAROL, 0.2 ether + 3, 1);
        assertEq(hamlock.pendingReward(CAROL), 0);
        mock.setWork(START_WORK + 2 * 1139);
        _open(CAROL);
        assertEq(CAROL.balance, 100 ether);
        assertEq(hamlock.accRewardPerWei(), index);
        assertEq(address(hamlock).balance, dust);
    }

    function testFuzz_penaltyRoundingAndPayout(uint96 amountSeed) public {
        uint256 amount = bound(amountSeed, 0.001 ether, 1 ether);
        _lock(ALICE, amount, 1);
        uint256 burnBefore = hamlock.BURN().balance;
        _break(ALICE);
        uint256 penalty = amount / 5;
        assertEq(ALICE.balance, 100 ether - penalty);
        assertEq(hamlock.BURN().balance - burnBefore, penalty);
        assertEq(hamlock.totalPenalties(), penalty);
        assertEq(address(hamlock).balance, 0);
    }

    function testFuzz_roundingAndChurnAlwaysCovered(
        uint96 firstSeed,
        uint96 secondSeed,
        uint96 breakerSeed,
        uint96 lateSeed,
        uint8 roundSeed
    ) public {
        uint256 first = bound(firstSeed, 0.001 ether, 1 ether);
        uint256 second = bound(secondSeed, 0.001 ether, 1 ether);
        uint256 breaker = bound(breakerSeed, 0.001 ether, 1 ether);
        uint256 late = bound(lateSeed, 0.001 ether, 1 ether);
        uint256 rounds = bound(roundSeed, 1, 20);
        _lock(ALICE, first, 100);
        _lock(BOB, second, 100);
        for (uint256 i; i < rounds; ++i) {
            _lock(CAROL, breaker, 100);
            _break(CAROL);
            _assertSolvent();
            _lock(DAVE, late, 100);
            assertEq(hamlock.pendingReward(DAVE), 0);
            _lock(CAROL, breaker, 100);
            _break(CAROL);
            _assertSolvent();
            _break(DAVE);
            _assertSolvent();
        }
        // Forfeiture recycles existing liabilities; it must not create additional ETH obligations.
        _break(BOB);
        _assertSolvent();
        vm.warp(START_TIME + 30 days);
        uint256 expected = uint256(_jar(ALICE).amount) + hamlock.pendingReward(ALICE);
        uint256 beforeBalance = ALICE.balance;
        _open(ALICE);
        assertEq(ALICE.balance - beforeBalance, expected);
        _assertSolvent();
        assertEq(hamlock.totalLocked(), 0);
        assertEq(hamlock.activeJars(), 0);
    }
}
