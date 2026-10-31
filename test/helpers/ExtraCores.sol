// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISqueekCore} from "../../src/Hamlock.sol";

/// @dev A valid core whose read burns a configurable amount of gas, standing in for an expensive upgrade.
contract HeavyCore is ISqueekCore {
    uint64 public work;
    uint256 public burnGas;

    constructor(uint64 work_, uint256 burnGas_) {
        work = work_;
        burnGas = burnGas_;
    }

    function setWork(uint64 newWork) external {
        work = newWork;
    }

    function setBurnGas(uint256 newBurn) external {
        burnGas = newBurn;
    }

    function state() external view returns (CoreState memory result) {
        uint256 start = gasleft();
        uint256 target = burnGas;
        while (start - gasleft() < target) {}
        result.cumulativeWork = work;
    }
}

/// @dev Minimal delegating proxy, as the live SqueekCore is a proxy. Storage lives here, logic elsewhere.
contract DelegatingProxy {
    address public immutable implementation;

    constructor(address implementation_) {
        implementation = implementation_;
    }

    fallback() external {
        address impl = implementation;
        assembly {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            if iszero(ok) { revert(0, returndatasize()) }
            return(0, returndatasize())
        }
    }
}

/// @dev A contract wallet that can be told to refuse ETH, driving every Hamlock entry point itself.
contract ToggleWallet {
    bool public reject;

    function setReject(bool value) external {
        reject = value;
    }

    function exec(address target, bytes calldata data, uint256 value)
        external
        returns (bool ok, bytes memory ret)
    {
        (ok, ret) = target.call{value: value}(data);
    }

    receive() external payable {
        require(!reject, "wallet refuses ETH");
    }
}
