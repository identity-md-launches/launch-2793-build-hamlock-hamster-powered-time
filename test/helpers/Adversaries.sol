// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Hamlock} from "../../src/Hamlock.sol";

/// @dev Attempts every state-changing entry point from an ETH callback, and records the observed state.
contract CallbackWallet {
    Hamlock public immutable hamlock;
    bool public rejectPayment;
    bool public attack;
    bool public lockSucceeded;
    bool public openSucceeded;
    bool public breakSucceeded;
    bytes4 public lockError;
    bytes4 public openError;
    bytes4 public breakError;
    uint256 public callbackCount;
    uint256 public observedAmount;
    uint256 public observedLocked;
    uint256 public observedActive;
    uint256 public observedCompleted;
    uint256 public observedBroken;

    constructor(Hamlock hamlock_) {
        hamlock = hamlock_;
    }

    function configure(bool reject_, bool attack_) external {
        rejectPayment = reject_;
        attack = attack_;
    }

    function lockJar(uint256 amount, uint16 km) external {
        hamlock.lock{value: amount}(km);
    }

    function openJar() external {
        hamlock.open();
    }

    function breakJar() external {
        hamlock.breakJar();
    }

    receive() external payable {
        require(!rejectPayment, "wallet rejects ETH");
        callbackCount += 1;
        (uint128 amount,,,,,) = hamlock.jars(address(this));
        observedAmount = amount;
        observedLocked = hamlock.totalLocked();
        observedActive = hamlock.activeJars();
        observedCompleted = hamlock.jarsCompleted(address(this));
        observedBroken = hamlock.jarsBroken(address(this));
        if (attack) {
            bytes memory result;
            (lockSucceeded, result) =
                address(hamlock).call{value: 0.001 ether}(abi.encodeCall(Hamlock.lock, (1)));
            lockError = bytes4(result);
            (openSucceeded, result) = address(hamlock).call(abi.encodeCall(Hamlock.open, ()));
            openError = bytes4(result);
            (breakSucceeded, result) = address(hamlock).call(abi.encodeCall(Hamlock.breakJar, ()));
            breakError = bytes4(result);
        }
    }
}

contract RejectEther {
    receive() external payable {
        revert("no ETH");
    }
}

contract EmptyReturnCore {
    fallback() external {
        assembly {
            return(0, 0)
        }
    }
}

contract ShortReturnCore {
    fallback() external {
        assembly {
            mstore(0, 1)
            mstore(32, 2)
            return(0, 64)
        }
    }
}

contract DirtyWorkCore {
    fallback() external {
        bytes memory result = new bytes(256);
        assembly {
            // cumulativeWork must fit in uint64. A dirty upper bit must not be silently truncated.
            mstore(add(result, 64), 0x10000000000000000)
            return(add(result, 32), 256)
        }
    }
}

contract DirtyBoolCore {
    fallback() external {
        bytes memory result = new bytes(256);
        assembly {
            mstore(add(result, 256), 2)
            return(add(result, 32), 256)
        }
    }
}

contract GasHungryCore {
    fallback() external {
        assembly {
            for {} 1 {} {}
        }
    }
}

contract OversizedReturnCore {
    fallback() external {
        assembly {
            return(0, 0x100000)
        }
    }
}

contract OversizedRevertCore {
    fallback() external {
        assembly {
            revert(0, 0x100000)
        }
    }
}

contract WritingCore {
    uint256 public calls;

    fallback() external {
        calls += 1;
    }
}
