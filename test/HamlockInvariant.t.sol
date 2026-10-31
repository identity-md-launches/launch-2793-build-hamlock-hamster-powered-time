// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Hamlock} from "../src/Hamlock.sol";
import {MockCore} from "./helpers/MockCore.sol";
import {TestBase} from "./helpers/TestBase.sol";

/// @dev No ignored reverts: each action checks its preconditions; unexpected contract failures fail the run.
contract HamlockHandler is TestBase {
    Hamlock public immutable hamlock;
    MockCore public immutable mock;
    address[8] public actors;
    uint256 public deposited;
    uint256 public paidOut;
    uint256 public burned;
    uint256 public penalties;
    uint256 public forcedSurplus;
    uint256 public successfulLocks;
    uint256 public successfulOpens;
    uint256 public successfulBreaks;
    mapping(address => uint256) public expectedKm;
    mapping(address => uint256) public expectedCompleted;
    mapping(address => uint256) public expectedBroken;

    constructor(Hamlock hamlock_, MockCore mock_) {
        hamlock = hamlock_;
        mock = mock_;
        for (uint256 i; i < actors.length; ++i) {
            actors[i] = address(uint160(uint256(keccak256(abi.encode("invariant actor", i)))));
            vm.deal(actors[i], 10_000 ether);
        }
    }

    function lock(uint256 actorSeed, uint96 amountSeed, uint16 kmSeed) external {
        address actor = actors[actorSeed % actors.length];
        (uint128 existing,,,,,) = hamlock.jars(actor);
        if (existing != 0 || mock.unavailable()) return;
        uint256 amount = bound(amountSeed, 0.001 ether, 1 ether);
        uint16 km = uint16(bound(kmSeed, 1, 100));
        vm.prank(actor);
        hamlock.lock{value: amount}(km);
        deposited += amount;
        successfulLocks += 1;
        assertEq(hamlock.pendingReward(actor), 0);
    }

    function open(uint256 actorSeed) external {
        address actor = actors[actorSeed % actors.length];
        if (!hamlock.isOpenable(actor)) return;
        (uint128 amount,, uint64 target,, uint16 km,) = hamlock.jars(actor);
        uint256 expected = uint256(amount) + hamlock.pendingReward(actor);
        uint256 balanceBefore = actor.balance;
        vm.prank(actor);
        hamlock.open();
        uint256 received = actor.balance - balanceBefore;
        assertEq(received, expected);
        paidOut += received;
        successfulOpens += 1;
        if (!mock.unavailable() && mock.work() >= target) {
            expectedKm[actor] += km;
            expectedCompleted[actor] += 1;
        }
    }

    function breakJar(uint256 actorSeed) external {
        address actor = actors[actorSeed % actors.length];
        (uint128 amount,,,,,) = hamlock.jars(actor);
        if (amount == 0 || hamlock.isOpenable(actor)) return;
        uint256 balanceBefore = actor.balance;
        uint256 burnBefore = hamlock.BURN().balance;
        uint256 penalty = uint256(amount) / 5;
        penalties += penalty + hamlock.pendingReward(actor);
        vm.prank(actor);
        hamlock.breakJar();
        uint256 received = actor.balance - balanceBefore;
        assertEq(received, uint256(amount) - penalty);
        paidOut += received;
        burned += hamlock.BURN().balance - burnBefore;
        expectedBroken[actor] += 1;
        successfulBreaks += 1;
    }

    function advanceWork(uint16 workSeed) external {
        mock.setWork(mock.work() + uint64(bound(workSeed, 0, 20_000)));
    }

    function advanceTime(uint32 timeSeed) external {
        vm.warp(block.timestamp + bound(timeSeed, 0, 5 days));
    }

    function coreAvailability(bool unavailable) external {
        mock.setUnavailable(unavailable);
    }

    function forceSurplus(uint64 valueSeed) external {
        uint256 amount = bound(valueSeed, 0, 0.001 ether);
        vm.deal(address(hamlock), address(hamlock).balance + amount);
        forcedSurplus += amount;
    }

    /// @dev Called by afterInvariant to prove every remaining liability can actually be paid out.
    function settleAll() external {
        vm.warp(block.timestamp + 30 days);
        mock.setUnavailable(true);
        for (uint256 i; i < actors.length; ++i) {
            (uint128 amount,,,,,) = hamlock.jars(actors[i]);
            if (amount == 0) continue;
            uint256 expected = uint256(amount) + hamlock.pendingReward(actors[i]);
            uint256 beforeBalance = actors[i].balance;
            vm.prank(actors[i]);
            hamlock.open();
            uint256 received = actors[i].balance - beforeBalance;
            assertEq(received, expected);
            paidOut += received;
            successfulOpens += 1;
        }
    }
}

contract HamlockInvariantTest is TestBase {
    struct FuzzSelector {
        address addr;
        bytes4[] selectors;
    }

    Hamlock internal hamlock;
    HamlockHandler internal handler;
    uint256 internal initialBurnBalance;

    function setUp() public {
        vm.chainId(11155111);
        vm.warp(1_700_000_000);
        MockCore mock = new MockCore();
        hamlock = new Hamlock(address(mock));
        handler = new HamlockHandler(hamlock, mock);
        initialBurnBalance = hamlock.BURN().balance;
        // Start with real deposits and one redistribution, so no run is vacuous.
        handler.lock(0, 0.3 ether, 99);
        handler.lock(1, 0.1 ether, 99);
        handler.lock(2, 0.5 ether, 99);
        handler.breakJar(2);
    }

    function targetContracts() public view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    function targetSelectors() public view returns (FuzzSelector[] memory targets) {
        bytes4[] memory selectors = new bytes4[](7);
        selectors[0] = HamlockHandler.lock.selector;
        selectors[1] = HamlockHandler.open.selector;
        selectors[2] = HamlockHandler.breakJar.selector;
        selectors[3] = HamlockHandler.advanceWork.selector;
        selectors[4] = HamlockHandler.advanceTime.selector;
        selectors[5] = HamlockHandler.coreAvailability.selector;
        selectors[6] = HamlockHandler.forceSurplus.selector;
        targets = new FuzzSelector[](1);
        targets[0] = FuzzSelector(address(handler), selectors);
    }

    function invariant_balanceCoversEveryDepositAndEveryPendingReward() public view {
        uint256 principal;
        uint256 rewards;
        uint256 count;
        for (uint256 i; i < 8; ++i) {
            address actor = handler.actors(i);
            (uint128 amount, uint64 start, uint64 target, uint64 deadline, uint16 km, uint256 debt) =
                hamlock.jars(actor);
            principal += amount;
            rewards += hamlock.pendingReward(actor);
            if (amount != 0) {
                count += 1;
                assertTrue(amount >= 0.001 ether && amount <= 1 ether);
                assertTrue(km >= 1 && km <= 100);
                assertEq(uint256(target) - start, uint256(km) * 1139);
            } else {
                assertEq(start, 0);
                assertEq(target, 0);
                assertEq(deadline, 0);
                assertEq(km, 0);
                assertEq(debt, 0);
                assertEq(hamlock.pendingReward(actor), 0);
            }
            assertEq(hamlock.kmCompleted(actor), handler.expectedKm(actor));
            assertEq(hamlock.jarsCompleted(actor), handler.expectedCompleted(actor));
            assertEq(hamlock.jarsBroken(actor), handler.expectedBroken(actor));
        }
        assertEq(hamlock.totalLocked(), principal);
        assertEq(hamlock.activeJars(), count);
        // Donations must not conceal an accounting deficit: liabilities are covered without them.
        assertLe(handler.forcedSurplus(), address(hamlock).balance);
        assertLe(principal + rewards, address(hamlock).balance - handler.forcedSurplus());
        assertEq(
            handler.deposited() + handler.forcedSurplus(),
            address(hamlock).balance + handler.paidOut() + handler.burned()
        );
        assertEq(hamlock.totalBurned(), handler.burned());
        assertEq(hamlock.BURN().balance - initialBurnBalance, handler.burned());
        assertEq(hamlock.totalPenalties(), handler.penalties());
        assertEq(count, handler.successfulLocks() - handler.successfulOpens() - handler.successfulBreaks());
    }

    function afterInvariant() public {
        handler.settleAll();
        invariant_balanceCoversEveryDepositAndEveryPendingReward();
        assertEq(hamlock.totalLocked(), 0);
        assertEq(hamlock.activeJars(), 0);
    }
}
