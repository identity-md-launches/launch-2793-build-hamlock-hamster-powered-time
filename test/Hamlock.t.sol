// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Hamlock} from "../src/Hamlock.sol";
import {HamlockFixture} from "./helpers/HamlockFixture.sol";

contract HamlockTest is HamlockFixture {
    function test_constantsAndInitialState() public view {
        assertEq(hamlock.core(), address(mock));
        assertEq(hamlock.WORK_PER_KM(), 1139);
        assertEq(hamlock.MIN_KM(), 1);
        assertEq(hamlock.MAX_KM(), 100);
        assertEq(hamlock.MIN_DEPOSIT(), 0.001 ether);
        assertEq(hamlock.MAX_DEPOSIT(), 1 ether);
        assertEq(hamlock.MAX_DURATION(), 30 days);
        assertEq(hamlock.PENALTY_BPS(), 2000);
        assertEq(hamlock.BURN(), 0x000000000000000000000000000000000000dEaD);
        assertEq(hamlock.REWARD_SCALE(), 1e24);
        assertEq(hamlock.totalLocked(), 0);
        assertEq(hamlock.activeJars(), 0);
        assertEq(hamlock.totalPenalties(), 0);
        assertEq(hamlock.totalBurned(), 0);
        assertEq(hamlock.accRewardPerWei(), 0);
        (bool ok, uint64 work) = hamlock.currentWork();
        assertTrue(ok);
        assertEq(work, START_WORK);
        _assertEmpty(ALICE);
    }

    function test_lockInclusiveLimitsAndEvent() public {
        vm.expectEmit(true, false, false, true, address(hamlock));
        emit Locked(ALICE, 0.001 ether, 1, START_WORK, START_WORK + 1139, uint64(START_TIME + 30 days));
        _lock(ALICE, 0.001 ether, 1);
        _lock(BOB, 1 ether, 100);
        Hamlock.Jar memory jar = _jar(BOB);
        assertEq(jar.amount, 1 ether);
        assertEq(jar.startWork, START_WORK);
        assertEq(jar.targetWork, START_WORK + 113900);
        assertEq(jar.deadline, START_TIME + 30 days);
        assertEq(jar.km, 100);
        assertEq(jar.rewardDebt, 0);
        assertEq(hamlock.totalLocked(), 1.001 ether);
        assertEq(hamlock.activeJars(), 2);
        assertEq(address(hamlock).balance, 1.001 ether);
    }

    function testFuzz_validLock(uint96 valueSeed, uint16 kmSeed, uint64 workSeed) public {
        uint256 value = bound(valueSeed, 0.001 ether, 1 ether);
        uint16 km = uint16(bound(kmSeed, 1, 100));
        uint64 work = uint64(bound(workSeed, 0, type(uint64).max - 113900));
        mock.setWork(work);
        _lock(ALICE, value, km);
        Hamlock.Jar memory jar = _jar(ALICE);
        assertEq(jar.amount, value);
        assertEq(jar.startWork, work);
        assertEq(jar.targetWork, uint256(work) + uint256(km) * 1139);
        assertEq(jar.deadline, START_TIME + 30 days);
        assertEq(hamlock.workRemaining(ALICE), uint256(km) * 1139);
        _assertSolvent();
    }

    function test_rejectsInvalidDistances() public {
        vm.expectRevert(Hamlock.BadDistance.selector);
        _lock(ALICE, 0.1 ether, 0);
        vm.expectRevert(Hamlock.BadDistance.selector);
        _lock(ALICE, 0.1 ether, 101);
        vm.expectRevert(Hamlock.BadDistance.selector);
        _lock(ALICE, 0.1 ether, type(uint16).max);
        _assertEmpty(ALICE);
        assertEq(address(hamlock).balance, 0);
    }

    function test_rejectsInvalidDeposits() public {
        vm.expectRevert(Hamlock.BadDeposit.selector);
        _lock(ALICE, 0, 1);
        vm.expectRevert(Hamlock.BadDeposit.selector);
        _lock(ALICE, 0.001 ether - 1, 1);
        vm.expectRevert(Hamlock.BadDeposit.selector);
        _lock(ALICE, 1 ether + 1, 1);
        _assertEmpty(ALICE);
        assertEq(hamlock.totalLocked(), 0);
    }

    function test_oneJarPerWalletEvenWhenOpenable() public {
        _lock(ALICE, 0.1 ether, 1);
        vm.expectRevert(Hamlock.AlreadyHasJar.selector);
        _lock(ALICE, 0.1 ether, 2);
        mock.setWork(START_WORK + 1139);
        vm.expectRevert(Hamlock.AlreadyHasJar.selector);
        _lock(ALICE, 0, 0);
        assertEq(_jar(ALICE).amount, 0.1 ether);
        assertEq(hamlock.activeJars(), 1);
    }

    function test_noJarCannotOpenOrBreak() public {
        vm.expectRevert(Hamlock.NoJar.selector);
        _open(ALICE);
        vm.expectRevert(Hamlock.NoJar.selector);
        _break(ALICE);
    }

    function test_staysLockedUntilExactTargetThenPaysAndScores() public {
        _lock(ALICE, 0.5 ether, 3);
        uint64 target = START_WORK + 3 * 1139;
        mock.setWork(target - 1);
        assertEq(hamlock.workRemaining(ALICE), 1);
        assertFalse(hamlock.isOpenable(ALICE));
        vm.expectRevert(Hamlock.StillLocked.selector);
        _open(ALICE);
        mock.setWork(target);
        assertEq(hamlock.workRemaining(ALICE), 0);
        assertTrue(hamlock.isOpenable(ALICE));
        vm.expectEmit(true, false, false, true, address(hamlock));
        emit Opened(ALICE, 0.5 ether, 0, true, 3);
        _open(ALICE);
        assertEq(ALICE.balance, 100 ether);
        assertEq(hamlock.kmCompleted(ALICE), 3);
        assertEq(hamlock.jarsCompleted(ALICE), 1);
        assertEq(hamlock.jarsBroken(ALICE), 0);
        assertEq(hamlock.totalLocked(), 0);
        assertEq(hamlock.activeJars(), 0);
        _assertEmpty(ALICE);
        vm.expectRevert(Hamlock.NoJar.selector);
        _open(ALICE);
    }

    function test_exactDeadlineOpensWithoutScore() public {
        _lock(ALICE, 0.2 ether, 10);
        vm.warp(START_TIME + 30 days - 1);
        assertFalse(hamlock.isOpenable(ALICE));
        vm.expectRevert(Hamlock.StillLocked.selector);
        _open(ALICE);
        vm.warp(START_TIME + 30 days);
        assertTrue(hamlock.isOpenable(ALICE));
        // The distance getter remains a distance getter after time has expired.
        assertEq(hamlock.workRemaining(ALICE), 11390);
        vm.expectEmit(true, false, false, true, address(hamlock));
        emit Opened(ALICE, 0.2 ether, 0, false, 10);
        _open(ALICE);
        assertEq(ALICE.balance, 100 ether);
        assertEq(hamlock.kmCompleted(ALICE), 0);
        assertEq(hamlock.jarsCompleted(ALICE), 0);
        assertEq(hamlock.jarsBroken(ALICE), 0);
        _assertEmpty(ALICE);
    }

    function test_deadlineWorksWhenCoreReverts() public {
        _lock(ALICE, 0.2 ether, 10);
        mock.setUnavailable(true);
        vm.warp(START_TIME + 30 days);
        assertTrue(hamlock.isOpenable(ALICE));
        _open(ALICE);
        assertEq(ALICE.balance, 100 ether);
        assertEq(hamlock.jarsCompleted(ALICE), 0);
        assertEq(hamlock.kmCompleted(ALICE), 0);
        _assertEmpty(ALICE);
    }

    function test_deadlineStillChecksWorkAndScoresIfReached() public {
        _lock(ALICE, 0.2 ether, 10);
        vm.warp(START_TIME + 31 days);
        mock.setWork(START_WORK + 11390);
        _open(ALICE);
        assertEq(hamlock.jarsCompleted(ALICE), 1);
        assertEq(hamlock.kmCompleted(ALICE), 10);
    }

    function test_coreFailureBeforeDeadlineBlocksNewLocksAndOpenButAllowsBreak() public {
        _lock(ALICE, 0.5 ether, 1);
        mock.setWork(START_WORK + 1000);
        assertEq(hamlock.workRemaining(ALICE), 139);
        mock.setUnavailable(true);
        (bool ok, uint64 work) = hamlock.currentWork();
        assertFalse(ok);
        assertEq(work, 0);
        assertEq(hamlock.workRemaining(ALICE), 1139);
        assertFalse(hamlock.isOpenable(ALICE));
        vm.expectRevert(Hamlock.CoreUnavailable.selector);
        _lock(BOB, 0.1 ether, 1);
        vm.expectRevert(Hamlock.StillLocked.selector);
        _open(ALICE);
        _break(ALICE);
        assertEq(ALICE.balance, 99.9 ether);
        assertEq(hamlock.totalBurned(), 0.1 ether);
    }

    function test_workRemainingClampsAtTargetAndOnRegressingCore() public {
        _lock(ALICE, 0.1 ether, 2);
        mock.setWork(START_WORK + 100);
        assertEq(hamlock.workRemaining(ALICE), 2178);
        mock.setWork(START_WORK - 1);
        assertEq(hamlock.workRemaining(ALICE), 2278);
        mock.setWork(START_WORK + 2278 + 1);
        assertEq(hamlock.workRemaining(ALICE), 0);
        assertTrue(hamlock.isOpenable(ALICE));
    }

    function test_zeroWorkAndPausedCoreAreValidReadings() public {
        mock.setWork(0);
        mock.setPaused(true);
        (bool ok, uint64 work) = hamlock.currentWork();
        assertTrue(ok);
        assertEq(work, 0);
        _lock(ALICE, 0.1 ether, 1);
        assertEq(_jar(ALICE).startWork, 0);
        mock.setWork(1139);
        _open(ALICE);
        assertEq(hamlock.kmCompleted(ALICE), 1);
    }

    function test_cannotBreakAtTargetOrDeadline() public {
        _lock(ALICE, 0.5 ether, 1);
        _lock(BOB, 0.5 ether, 100);
        mock.setWork(START_WORK + 1139);
        vm.expectRevert(Hamlock.AlreadyOpenable.selector);
        _break(ALICE);
        vm.warp(START_TIME + 30 days);
        mock.setUnavailable(true);
        vm.expectRevert(Hamlock.AlreadyOpenable.selector);
        _break(BOB);
        assertEq(hamlock.totalLocked(), 1 ether);
        assertEq(hamlock.totalPenalties(), 0);
    }

    function test_onlyCallerCanExitTheirJar() public {
        _lock(ALICE, 0.5 ether, 1);
        vm.expectRevert(Hamlock.NoJar.selector);
        _break(BOB);
        mock.setWork(START_WORK + 1139);
        vm.expectRevert(Hamlock.NoJar.selector);
        _open(BOB);
        assertEq(_jar(ALICE).amount, 0.5 ether);
    }

    function test_walletCanRelockAndScoresAccumulate() public {
        _lock(ALICE, 0.1 ether, 2);
        mock.setWork(START_WORK + 2278);
        _open(ALICE);
        _lock(ALICE, 0.2 ether, 3);
        assertEq(_jar(ALICE).startWork, START_WORK + 2278);
        mock.setWork(START_WORK + 5 * 1139);
        _open(ALICE);
        _lock(ALICE, 0.3 ether, 1);
        _break(ALICE);
        assertEq(hamlock.kmCompleted(ALICE), 5);
        assertEq(hamlock.jarsCompleted(ALICE), 2);
        assertEq(hamlock.jarsBroken(ALICE), 1);
    }

    function test_targetAtUint64MaximumAndOverflowRejection() public {
        mock.setWork(type(uint64).max - 1139);
        _lock(ALICE, 0.1 ether, 1);
        assertEq(_jar(ALICE).targetWork, type(uint64).max);
        mock.setWork(type(uint64).max - 1138);
        vm.expectRevert(Hamlock.WorkOverflow.selector);
        _lock(BOB, 0.1 ether, 1);
        mock.setWork(type(uint64).max);
        _open(ALICE);
        assertEq(hamlock.jarsCompleted(ALICE), 1);
    }

    function test_deadlineAtUint64MaximumAndOverflowRejection() public {
        vm.warp(type(uint64).max - 30 days);
        _lock(ALICE, 0.1 ether, 1);
        assertEq(_jar(ALICE).deadline, type(uint64).max);
        vm.warp(type(uint64).max - 30 days + 1);
        vm.expectRevert(Hamlock.DeadlineOverflow.selector);
        _lock(BOB, 0.1 ether, 1);
        vm.warp(type(uint64).max);
        _open(ALICE);
        assertEq(hamlock.jarsCompleted(ALICE), 0);
    }
}
