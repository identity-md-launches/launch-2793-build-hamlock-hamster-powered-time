// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Hamlock} from "../src/Hamlock.sol";
import {MockCore} from "./helpers/MockCore.sol";
import {TestBase} from "./helpers/TestBase.sol";
import {ToggleWallet} from "./helpers/ExtraCores.sol";

/// @dev Unlike the first handler, this one also sends the calls that must fail and asserts the exact error
/// and that nothing moved. One actor is a contract wallet that can refuse ETH. Amounts are biased to the
/// limits and to odd wei so the reward index rounds on nearly every step. Any assertion failure inside a
/// handler reverts, and fail_on_revert turns it into a failed run.
contract AdversarialHandler is TestBase {
    Hamlock public immutable hamlock;
    MockCore public immutable mock;
    ToggleWallet public immutable wallet;
    address[6] public actors;

    uint256 public deposited;
    uint256 public paidOut;
    uint256 public burned;
    uint256 public shared;
    uint256 public locks;
    uint256 public opens;
    uint256 public breaks;
    uint256 public rejectedCalls;

    uint256 public lastAcc;
    uint256 public lastPenalties;
    uint256 public lastBurned;

    mapping(address => uint256) public ghostKm;
    mapping(address => uint256) public ghostCompleted;
    mapping(address => uint256) public ghostBroken;

    constructor(Hamlock hamlock_, MockCore mock_) {
        hamlock = hamlock_;
        mock = mock_;
        wallet = new ToggleWallet();
        for (uint256 i; i < 5; ++i) {
            actors[i] = address(uint160(uint256(keccak256(abi.encode("adversarial actor", i)))));
            vm.deal(actors[i], 10_000 ether);
        }
        actors[5] = address(wallet);
        vm.deal(address(wallet), 10_000 ether);
    }

    // ------------------------------------------------------------------ plumbing

    function _call(address actor, bytes memory data, uint256 value) internal returns (bool ok, bytes4 err) {
        bytes memory ret;
        if (actor == address(wallet)) {
            (ok, ret) = wallet.exec(address(hamlock), data, value);
        } else {
            vm.prank(actor);
            (ok, ret) = address(hamlock).call{value: value}(data);
        }
        if (ret.length >= 4) {
            assembly {
                err := mload(add(ret, 32))
            }
        }
    }

    function _amount(address actor) internal view returns (uint256 amount) {
        (amount,,,,,) = hamlock.jars(actor);
    }

    function _expectFailure(address actor, bytes memory data, uint256 value, bytes4 expected) internal {
        uint256 balance = address(hamlock).balance;
        uint256 locked = hamlock.totalLocked();
        uint256 acc = hamlock.accRewardPerWei();
        uint256 pending = hamlock.pendingReward(actor);
        uint256 amount = _amount(actor);
        (bool ok, bytes4 err) = _call(actor, data, value);
        assertFalse(ok);
        assertEq(err, expected);
        assertEq(address(hamlock).balance, balance);
        assertEq(hamlock.totalLocked(), locked);
        assertEq(hamlock.accRewardPerWei(), acc);
        assertEq(hamlock.pendingReward(actor), pending);
        assertEq(_amount(actor), amount);
        rejectedCalls += 1;
    }

    function _monotonic() internal {
        assertLe(lastAcc, hamlock.accRewardPerWei());
        assertLe(lastPenalties, hamlock.totalPenalties());
        assertLe(lastBurned, hamlock.totalBurned());
        lastAcc = hamlock.accRewardPerWei();
        lastPenalties = hamlock.totalPenalties();
        lastBurned = hamlock.totalBurned();
    }

    function _biasedAmount(uint256 seed) internal pure returns (uint256) {
        uint256 mode = seed % 4;
        uint256 noise = (seed >> 8) % 1_000_003;
        if (mode == 0) return 0.001 ether + noise;
        if (mode == 1) return 1 ether - noise;
        if (mode == 2) return 0.001 ether + (seed >> 8) % (1 ether - 0.001 ether + 1);
        return 0.333333333333333333 ether + noise;
    }

    // ------------------------------------------------------------------ actions

    function lock(uint256 actorSeed, uint256 amountSeed, uint16 kmSeed) external {
        address actor = actors[actorSeed % actors.length];
        uint256 amount = _biasedAmount(amountSeed);
        uint16 km = uint16(bound(kmSeed, 1, 100));
        bytes memory data = abi.encodeCall(Hamlock.lock, (km));
        if (_amount(actor) != 0) {
            _expectFailure(actor, data, amount, Hamlock.AlreadyHasJar.selector);
            return;
        }
        if (mock.unavailable()) {
            _expectFailure(actor, data, amount, Hamlock.CoreUnavailable.selector);
            return;
        }
        (bool ok,) = _call(actor, data, amount);
        assertTrue(ok);
        (uint128 got, uint64 start, uint64 target, uint64 deadline, uint16 gotKm,) = hamlock.jars(actor);
        assertEq(got, amount);
        assertEq(start, mock.work());
        assertEq(target, uint256(mock.work()) + uint256(km) * 1139);
        assertEq(deadline, block.timestamp + 30 days);
        assertEq(gotKm, km);
        // Joining never gives a claim on earlier penalties.
        assertEq(hamlock.pendingReward(actor), 0);
        deposited += amount;
        locks += 1;
        _monotonic();
    }

    function badLock(uint256 actorSeed, uint256 valueSeed, uint16 km) external {
        address actor = actors[actorSeed % actors.length];
        uint256 value = valueSeed % 3 == 0
            ? bound(valueSeed, 0, 0.001 ether - 1)
            : (valueSeed % 3 == 1 ? bound(valueSeed, 1 ether + 1, 5 ether) : 0.01 ether);
        if (valueSeed % 3 == 2 && km >= 1 && km <= 100) km = valueSeed % 2 == 0 ? 0 : 101;
        bytes memory data = abi.encodeCall(Hamlock.lock, (km));
        bytes4 expected;
        if (_amount(actor) != 0) expected = Hamlock.AlreadyHasJar.selector;
        else if (km < 1 || km > 100) expected = Hamlock.BadDistance.selector;
        else expected = Hamlock.BadDeposit.selector;
        _expectFailure(actor, data, value, expected);
    }

    function open(uint256 actorSeed) external {
        address actor = actors[actorSeed % actors.length];
        bytes memory data = abi.encodeCall(Hamlock.open, ());
        (uint128 amount,, uint64 target, uint64 deadline, uint16 km,) = hamlock.jars(actor);
        if (amount == 0) {
            _expectFailure(actor, data, 0, Hamlock.NoJar.selector);
            return;
        }
        bool ran = !mock.unavailable() && mock.work() >= target;
        bool openable = ran || block.timestamp >= deadline;
        assertEq(hamlock.isOpenable(actor) ? 1 : 0, openable ? 1 : 0);
        if (!openable) {
            _expectFailure(actor, data, 0, Hamlock.StillLocked.selector);
            return;
        }
        if (actor == address(wallet) && wallet.reject()) {
            {
                _expectFailure(actor, data, 0, Hamlock.TransferFailed.selector);
                return;
            }
        }
        uint256 expected = uint256(amount) + hamlock.pendingReward(actor);
        uint256 before = actor.balance;
        (bool ok,) = _call(actor, data, 0);
        assertTrue(ok);
        assertEq(actor.balance - before, expected);
        assertEq(_amount(actor), 0);
        paidOut += expected;
        opens += 1;
        if (ran) {
            ghostKm[actor] += km;
            ghostCompleted[actor] += 1;
        }
        _monotonic();
    }

    function breakJar(uint256 actorSeed) external {
        address actor = actors[actorSeed % actors.length];
        bytes memory data = abi.encodeCall(Hamlock.breakJar, ());
        uint256 amount = _amount(actor);
        if (amount == 0) {
            _expectFailure(actor, data, 0, Hamlock.NoJar.selector);
            return;
        }
        if (hamlock.isOpenable(actor)) {
            _expectFailure(actor, data, 0, Hamlock.AlreadyOpenable.selector);
            return;
        }
        if (actor == address(wallet) && wallet.reject()) {
            {
                _expectFailure(actor, data, 0, Hamlock.TransferFailed.selector);
                return;
            }
        }
        uint256 forfeited = hamlock.pendingReward(actor);
        uint256 penalty = amount * 2000 / 10_000;
        bool lastOne = hamlock.totalLocked() == amount;
        uint256 before = actor.balance;
        uint256 burnBefore = hamlock.BURN().balance;
        uint256 accBefore = hamlock.accRewardPerWei();
        (bool ok,) = _call(actor, data, 0);
        assertTrue(ok);
        assertEq(actor.balance - before, amount - penalty);
        uint256 burnt = hamlock.BURN().balance - burnBefore;
        if (lastOne) {
            assertEq(burnt, penalty + forfeited);
            assertEq(hamlock.accRewardPerWei(), accBefore);
        } else {
            assertEq(burnt, 0);
        }
        paidOut += amount - penalty;
        burned += burnt;
        shared += penalty + forfeited;
        breaks += 1;
        ghostBroken[actor] += 1;
        _monotonic();
    }

    function advanceWork(uint256 seed) external {
        // Small steps land near targets; large ones cross several at once.
        uint256 step = seed % 2 == 0 ? bound(seed, 0, 1500) : bound(seed, 0, 40_000);
        mock.setWork(mock.work() + uint64(step));
    }

    function advanceTime(uint256 seed) external {
        uint256 step = seed % 2 == 0 ? bound(seed, 0, 2 hours) : bound(seed, 0, 12 days);
        vm.warp(block.timestamp + step);
    }

    function setCoreDown(bool down) external {
        mock.setUnavailable(down);
    }

    function setWalletRejects(bool reject) external {
        wallet.setReject(reject);
    }

    function settleAll() external {
        wallet.setReject(false);
        mock.setUnavailable(false);
        vm.warp(block.timestamp + 30 days);
        for (uint256 i; i < actors.length; ++i) {
            if (_amount(actors[i]) != 0) this.open(i);
        }
    }

    function actorCount() external pure returns (uint256) {
        return 6;
    }
}

contract HamlockAdversarialInvariantTest is TestBase {
    struct FuzzSelector {
        address addr;
        bytes4[] selectors;
    }

    Hamlock internal hamlock;
    AdversarialHandler internal handler;
    uint256 internal burnStart;

    function setUp() public {
        vm.chainId(11155111);
        vm.warp(1_700_000_000);
        MockCore mock = new MockCore();
        mock.setWork(5_000);
        hamlock = new Hamlock(address(mock));
        handler = new AdversarialHandler(hamlock, mock);
        burnStart = hamlock.BURN().balance;
        // Seed state so that every run starts with a funded pool and a nonzero reward index.
        handler.lock(0, 2, 50);
        handler.lock(5, 1, 50);
        handler.lock(1, 3, 50);
        handler.breakJar(1);
    }

    function targetContracts() public view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    function targetSelectors() public view returns (FuzzSelector[] memory targets) {
        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = AdversarialHandler.lock.selector;
        selectors[1] = AdversarialHandler.badLock.selector;
        selectors[2] = AdversarialHandler.open.selector;
        selectors[3] = AdversarialHandler.breakJar.selector;
        selectors[4] = AdversarialHandler.advanceWork.selector;
        selectors[5] = AdversarialHandler.advanceTime.selector;
        selectors[6] = AdversarialHandler.setCoreDown.selector;
        selectors[7] = AdversarialHandler.setWalletRejects.selector;
        targets = new FuzzSelector[](1);
        targets[0] = FuzzSelector(address(handler), selectors);
    }

    function _liabilities() internal view returns (uint256 principal, uint256 rewards, uint256 count) {
        for (uint256 i; i < 6; ++i) {
            address actor = handler.actors(i);
            (uint128 amount,,,,,) = hamlock.jars(actor);
            principal += amount;
            rewards += hamlock.pendingReward(actor);
            if (amount != 0) count += 1;
        }
    }

    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 128
    function invariant_solventConservedAndDustBounded() public view {
        (uint256 principal, uint256 rewards, uint256 count) = _liabilities();
        uint256 balance = address(hamlock).balance;
        // Every deposit and every pending reward is covered by what the contract holds.
        assertLe(principal + rewards, balance);
        // Every wei that came in is still held, was paid to an owner, or was burned.
        assertEq(handler.deposited(), balance + handler.paidOut() + handler.burned());
        // Rounding keeps at most a few wei per operation: penalties are really distributed, not hoarded.
        uint256 dust = balance - principal - rewards;
        assertLe(dust, 3 * handler.breaks() + 2 * handler.opens() + 2 * count + 1);
        assertEq(hamlock.totalLocked(), principal);
        assertEq(hamlock.activeJars(), count);
        assertEq(count, handler.locks() - handler.opens() - handler.breaks());
        assertEq(hamlock.totalPenalties(), handler.shared());
        assertEq(hamlock.totalBurned(), handler.burned());
        assertEq(hamlock.BURN().balance - burnStart, handler.burned());
        assertLe(hamlock.totalBurned(), hamlock.totalPenalties());
    }

    function invariant_scoresMatchGhosts() public view {
        for (uint256 i; i < 6; ++i) {
            address actor = handler.actors(i);
            assertEq(hamlock.kmCompleted(actor), handler.ghostKm(actor));
            assertEq(hamlock.jarsCompleted(actor), handler.ghostCompleted(actor));
            assertEq(hamlock.jarsBroken(actor), handler.ghostBroken(actor));
            assertLe(hamlock.kmCompleted(actor), 100 * hamlock.jarsCompleted(actor));
        }
    }

    function afterInvariant() public {
        handler.settleAll();
        (uint256 principal, uint256 rewards, uint256 count) = _liabilities();
        assertEq(principal + rewards + count, 0);
        assertEq(hamlock.totalLocked(), 0);
        assertEq(hamlock.activeJars(), 0);
        assertEq(handler.deposited(), address(hamlock).balance + handler.paidOut() + handler.burned());
        assertLe(address(hamlock).balance, 3 * handler.breaks() + 2 * handler.opens() + 1);
    }
}
