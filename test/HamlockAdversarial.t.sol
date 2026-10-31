// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Hamlock} from "../src/Hamlock.sol";
import {HamlockFixture} from "./helpers/HamlockFixture.sol";
import {
    CallbackWallet,
    RejectEther,
    EmptyReturnCore,
    ShortReturnCore,
    DirtyWorkCore,
    DirtyBoolCore,
    GasHungryCore,
    OversizedReturnCore,
    OversizedRevertCore,
    WritingCore
} from "./helpers/Adversaries.sol";

contract HamlockAdversarialTest is HamlockFixture {
    function test_reentrancyAllEntryPointsDuringOpenAndEffectsVisible() public {
        CallbackWallet wallet = _wallet();
        wallet.lockJar(0.5 ether, 1);
        _lock(ALICE, 0.2 ether, 100);
        _break(ALICE);
        wallet.configure(false, true);
        mock.setWork(START_WORK + 1139);
        wallet.openJar();
        _assertCallbacksRejected(wallet);
        assertEq(wallet.observedAmount(), 0);
        assertEq(wallet.observedLocked(), 0);
        assertEq(wallet.observedActive(), 0);
        assertEq(wallet.observedCompleted(), 1);
        assertEq(wallet.observedBroken(), 0);
        assertEq(address(wallet).balance, 2.04 ether);
        assertEq(address(hamlock).balance, 0);
        // The guard is released after the payout.
        wallet.lockJar(0.1 ether, 1);
        assertEq(_jar(address(wallet)).amount, 0.1 ether);
    }

    function test_reentrancyAllEntryPointsDuringBreakWithOtherHolder() public {
        CallbackWallet wallet = _wallet();
        wallet.lockJar(0.5 ether, 1);
        _lock(ALICE, 0.1 ether, 1);
        wallet.configure(false, true);
        wallet.breakJar();
        _assertCallbacksRejected(wallet);
        assertEq(wallet.observedAmount(), 0);
        assertEq(wallet.observedLocked(), 0.1 ether);
        assertEq(wallet.observedActive(), 1);
        assertEq(wallet.observedBroken(), 1);
        assertEq(hamlock.pendingReward(ALICE), 0.1 ether);
        assertEq(address(wallet).balance, 1.9 ether);
        _assertSolvent();
    }

    function test_reentrancyDuringLastHolderBreak() public {
        CallbackWallet wallet = _wallet();
        wallet.lockJar(0.5 ether, 1);
        wallet.configure(false, true);
        uint256 burnBefore = hamlock.BURN().balance;
        wallet.breakJar();
        _assertCallbacksRejected(wallet);
        assertEq(wallet.observedLocked(), 0);
        assertEq(wallet.observedActive(), 0);
        assertEq(hamlock.BURN().balance - burnBefore, 0.1 ether);
        assertEq(hamlock.totalBurned(), 0.1 ether);
    }

    function test_failedOpenRestoresJarRewardsAndScoreOtherUsersCanExit() public {
        CallbackWallet wallet = _wallet();
        wallet.lockJar(0.5 ether, 1);
        _lock(ALICE, 0.5 ether, 1);
        _lock(BOB, 0.5 ether, 100);
        _break(BOB);
        uint256 rewardBefore = hamlock.pendingReward(address(wallet));
        uint256 balanceBefore = address(hamlock).balance;
        wallet.configure(true, false);
        mock.setWork(START_WORK + 1139);
        vm.expectRevert(Hamlock.TransferFailed.selector);
        wallet.openJar();
        assertEq(_jar(address(wallet)).amount, 0.5 ether);
        assertEq(hamlock.pendingReward(address(wallet)), rewardBefore);
        assertEq(address(hamlock).balance, balanceBefore);
        assertEq(hamlock.totalLocked(), 1 ether);
        assertEq(hamlock.activeJars(), 2);
        assertEq(hamlock.jarsCompleted(address(wallet)), 0);
        assertEq(hamlock.kmCompleted(address(wallet)), 0);
        _open(ALICE);
        wallet.configure(false, false);
        wallet.openJar();
        assertEq(address(wallet).balance, 2.05 ether);
        assertEq(address(hamlock).balance, 0);
    }

    function test_failedBreakRefundRestoresRedistributionAndDebt() public {
        CallbackWallet wallet = _wallet();
        wallet.lockJar(0.5 ether, 1);
        _lock(ALICE, 0.5 ether, 1);
        _lock(BOB, 0.5 ether, 1);
        _break(BOB);
        uint256 indexBefore = hamlock.accRewardPerWei();
        uint256 penaltyBefore = hamlock.totalPenalties();
        uint256 rewardBefore = hamlock.pendingReward(address(wallet));
        wallet.configure(true, false);
        vm.expectRevert(Hamlock.TransferFailed.selector);
        wallet.breakJar();
        assertEq(hamlock.accRewardPerWei(), indexBefore);
        assertEq(hamlock.totalPenalties(), penaltyBefore);
        assertEq(hamlock.pendingReward(address(wallet)), rewardBefore);
        assertEq(hamlock.jarsBroken(address(wallet)), 0);
        assertEq(hamlock.totalLocked(), 1 ether);
        assertEq(hamlock.activeJars(), 2);
        wallet.configure(false, false);
        wallet.breakJar();
        assertEq(hamlock.pendingReward(ALICE), 0.2 ether);
    }

    function test_failedLastRefundAlsoRollsBackBurnTransfer() public {
        CallbackWallet wallet = _wallet();
        wallet.lockJar(0.5 ether, 1);
        wallet.configure(true, false);
        uint256 burnBefore = hamlock.BURN().balance;
        vm.expectRevert(Hamlock.TransferFailed.selector);
        wallet.breakJar();
        assertEq(hamlock.BURN().balance, burnBefore);
        assertEq(hamlock.totalBurned(), 0);
        assertEq(hamlock.totalPenalties(), 0);
        assertEq(hamlock.jarsBroken(address(wallet)), 0);
        assertEq(_jar(address(wallet)).amount, 0.5 ether);
        assertEq(address(hamlock).balance, 0.5 ether);
        wallet.configure(false, false);
        wallet.breakJar();
        assertEq(hamlock.totalBurned(), 0.1 ether);
    }

    function test_failedBurnTransferRollsBackEverything() public {
        _lock(ALICE, 0.5 ether, 1);
        vm.etch(hamlock.BURN(), type(RejectEther).runtimeCode);
        vm.expectRevert(Hamlock.TransferFailed.selector);
        _break(ALICE);
        assertEq(_jar(ALICE).amount, 0.5 ether);
        assertEq(hamlock.totalLocked(), 0.5 ether);
        assertEq(hamlock.activeJars(), 1);
        assertEq(hamlock.totalPenalties(), 0);
        assertEq(hamlock.totalBurned(), 0);
        assertEq(hamlock.jarsBroken(ALICE), 0);
        vm.etch(hamlock.BURN(), hex"");
        _break(ALICE);
    }

    function test_missingCoreCodeCannotTrapTimeout() public {
        _checkUnavailableCore(hex"");
    }

    function test_emptyReturnDataCannotTrapTimeout() public {
        _checkUnavailableCore(type(EmptyReturnCore).runtimeCode);
    }

    function test_shortReturnDataCannotTrapTimeout() public {
        _checkUnavailableCore(type(ShortReturnCore).runtimeCode);
    }

    function test_dirtyWorkReturnDataCannotTrapTimeout() public {
        _checkUnavailableCore(type(DirtyWorkCore).runtimeCode);
    }

    function test_dirtyBooleanReturnDataCannotTrapTimeout() public {
        _checkUnavailableCore(type(DirtyBoolCore).runtimeCode);
    }

    function test_gasHungryCoreCannotTrapTimeout() public {
        _checkUnavailableCore(type(GasHungryCore).runtimeCode);
    }

    function test_oversizedReturnDataCannotTrapTimeout() public {
        _checkUnavailableCore(type(OversizedReturnCore).runtimeCode);
    }

    function test_oversizedRevertDataCannotTrapTimeout() public {
        _checkUnavailableCore(type(OversizedRevertCore).runtimeCode);
    }

    function test_coreCannotWriteDuringRead() public {
        WritingCore writer = new WritingCore();
        Hamlock reader = new Hamlock(address(writer));
        (bool ok,) = reader.currentWork();
        assertFalse(ok);
        assertEq(writer.calls(), 0);
        vm.expectRevert(Hamlock.CoreUnavailable.selector);
        vm.prank(ALICE);
        reader.lock{value: 0.1 ether}(1);
        assertEq(writer.calls(), 0);
    }

    function test_readHelperOnlyCallableBySelf() public {
        vm.expectRevert(Hamlock.OnlySelf.selector);
        hamlock.readCoreWork();
    }

    function test_unsolicitedETHRejectedAndForcedSurplusDoesNotAffectRewards() public {
        vm.deal(address(this), 1 ether);
        (bool accepted,) = address(hamlock).call{value: 0.1 ether}("");
        assertFalse(accepted);
        (accepted,) = address(hamlock).call{value: 0.1 ether}(hex"12345678");
        assertFalse(accepted);
        _lock(ALICE, 0.5 ether, 1);
        // Simulate unavoidable ETH (e.g. block fee recipient), without any destructive opcode.
        vm.deal(address(hamlock), address(hamlock).balance + 0.1 ether);
        assertEq(hamlock.pendingReward(ALICE), 0);
        mock.setWork(START_WORK + 1139);
        _open(ALICE);
        assertEq(ALICE.balance, 100 ether);
        assertEq(address(hamlock).balance, 0.1 ether);
    }

    function _wallet() internal returns (CallbackWallet wallet) {
        wallet = new CallbackWallet(hamlock);
        vm.deal(address(wallet), 2 ether);
    }

    function _assertCallbacksRejected(CallbackWallet wallet) internal view {
        assertEq(wallet.callbackCount(), 1);
        assertFalse(wallet.lockSucceeded());
        assertFalse(wallet.openSucceeded());
        assertFalse(wallet.breakSucceeded());
        assertEq(wallet.lockError(), Hamlock.ReentrantCall.selector);
        assertEq(wallet.openError(), Hamlock.ReentrantCall.selector);
        assertEq(wallet.breakError(), Hamlock.ReentrantCall.selector);
    }

    function _checkUnavailableCore(bytes memory runtimeCode) internal {
        _lock(ALICE, 0.5 ether, 1);
        vm.etch(address(mock), runtimeCode);
        (bool ok, uint64 work) = hamlock.currentWork();
        assertFalse(ok);
        assertEq(work, 0);
        assertFalse(hamlock.isOpenable(ALICE));
        assertEq(hamlock.workRemaining(ALICE), 1139);
        vm.expectRevert(Hamlock.CoreUnavailable.selector);
        _lock(BOB, 0.1 ether, 1);
        vm.expectRevert(Hamlock.StillLocked.selector);
        _open(ALICE);
        vm.warp(START_TIME + 30 days);
        assertTrue(hamlock.isOpenable(ALICE));
        // Enough gas for the fixed read budget and the rest of the withdrawal, even under core OOG.
        vm.prank(ALICE);
        (bool opened,) = address(hamlock).call{gas: 400_000}(abi.encodeCall(Hamlock.open, ()));
        assertTrue(opened);
        assertEq(ALICE.balance, 100 ether);
        assertEq(hamlock.jarsCompleted(ALICE), 0);
        assertEq(hamlock.totalLocked(), 0);
        _assertEmpty(ALICE);
    }
}
