// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Hamlock} from "../../src/Hamlock.sol";
import {MockCore} from "./MockCore.sol";
import {TestBase} from "./TestBase.sol";

abstract contract HamlockFixture is TestBase {
    Hamlock internal hamlock;
    MockCore internal mock;
    address internal constant ALICE = address(uint160(uint256(keccak256("test alice"))));
    address internal constant BOB = address(uint160(uint256(keccak256("test bob"))));
    address internal constant CAROL = address(uint160(uint256(keccak256("test carol"))));
    address internal constant DAVE = address(uint160(uint256(keccak256("test dave"))));
    uint64 internal constant START_WORK = 10_000;
    uint256 internal constant START_TIME = 1_700_000_000;

    event Locked(
        address indexed owner, uint256 amount, uint16 km, uint64 startWork, uint64 targetWork, uint64 deadline
    );
    event Opened(address indexed owner, uint256 amount, uint256 reward, bool hamsterRanIt, uint16 km);
    event Broken(address indexed owner, uint256 refund, uint256 penalty, uint256 forfeited, bool burned);

    function setUp() public virtual {
        vm.chainId(11155111);
        vm.warp(START_TIME);
        mock = new MockCore();
        mock.setWork(START_WORK);
        hamlock = new Hamlock(address(mock));
        vm.deal(ALICE, 100 ether);
        vm.deal(BOB, 100 ether);
        vm.deal(CAROL, 100 ether);
        vm.deal(DAVE, 100 ether);
    }

    function _lock(address owner, uint256 amount, uint16 km) internal {
        vm.prank(owner);
        hamlock.lock{value: amount}(km);
    }

    function _open(address owner) internal {
        vm.prank(owner);
        hamlock.open();
    }

    function _break(address owner) internal {
        vm.prank(owner);
        hamlock.breakJar();
    }

    function _jar(address owner) internal view returns (Hamlock.Jar memory jar) {
        (jar.amount, jar.startWork, jar.targetWork, jar.deadline, jar.km, jar.rewardDebt) =
            hamlock.jars(owner);
    }

    function _assertEmpty(address owner) internal view {
        Hamlock.Jar memory jar = _jar(owner);
        assertEq(jar.amount, 0);
        assertEq(jar.startWork, 0);
        assertEq(jar.targetWork, 0);
        assertEq(jar.deadline, 0);
        assertEq(jar.km, 0);
        assertEq(jar.rewardDebt, 0);
        assertEq(hamlock.pendingReward(owner), 0);
        assertEq(hamlock.workRemaining(owner), 0);
        assertFalse(hamlock.isOpenable(owner));
    }

    function _assertSolvent() internal view {
        uint256 owed = hamlock.totalLocked() + hamlock.pendingReward(ALICE) + hamlock.pendingReward(BOB)
            + hamlock.pendingReward(CAROL) + hamlock.pendingReward(DAVE);
        assertLe(owed, address(hamlock).balance);
    }
}
