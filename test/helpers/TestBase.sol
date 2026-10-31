// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev Minimal Foundry cheatcode interface; the project needs no third-party Solidity dependencies.
interface Vm {
    function deal(address account, uint256 newBalance) external;
    function prank(address msgSender) external;
    function startPrank(address msgSender) external;
    function stopPrank() external;
    function warp(uint256 newTimestamp) external;
    function chainId(uint256 newChainId) external;
    function etch(address target, bytes calldata newRuntimeBytecode) external;
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData, address emitter)
        external;
}

abstract contract TestBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function assertTrue(bool value) internal pure {
        require(value, "expected true");
    }

    function assertFalse(bool value) internal pure {
        require(!value, "expected false");
    }

    function assertEq(uint256 a, uint256 b) internal pure {
        require(a == b, "unequal integers");
    }

    function assertEq(address a, address b) internal pure {
        require(a == b, "unequal addresses");
    }

    function assertEq(bytes4 a, bytes4 b) internal pure {
        require(a == b, "unequal selectors");
    }

    function assertLe(uint256 a, uint256 b) internal pure {
        require(a <= b, "not less than or equal");
    }

    function bound(uint256 value, uint256 min, uint256 max) internal pure returns (uint256) {
        return min + value % (max - min + 1);
    }
}
