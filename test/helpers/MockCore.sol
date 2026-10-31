// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISqueekCore} from "../../src/Hamlock.sol";

contract MockCore is ISqueekCore {
    uint64 public work;
    bool public unavailable;
    bool public paused;

    function setWork(uint64 newWork) external {
        work = newWork;
    }

    function setUnavailable(bool value) external {
        unavailable = value;
    }

    function setPaused(bool value) external {
        paused = value;
    }

    function state() external view returns (CoreState memory result) {
        require(!unavailable, "mock core unavailable");
        // Distinct fields ensure the consumer reads cumulativeWork, not an adjacent tuple member.
        result = CoreState({
            settledThroughRound: 71,
            cumulativeWork: work,
            cumulativeBlockUnits: 123456,
            blockHeight: 800,
            blockProgress: 55,
            workPerThousandBlocks: 999,
            authorizationNonce: 42,
            paused: paused
        });
    }
}
