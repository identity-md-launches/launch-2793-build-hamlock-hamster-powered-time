// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Hamlock} from "../src/Hamlock.sol";
import {TestBase} from "./helpers/TestBase.sol";

contract DeploymentFactory {
    function deploy(address core) external returns (Hamlock) {
        return new Hamlock{salt: keccak256("HAMLOCK deployment rehearsal")}(core);
    }
}

contract HamlockDeploymentTest is TestBase {
    address internal constant SEPOLIA_CORE = address(bytes20(hex"980b4424c007caf7a1f3670b48c8eaef7ebc3d44"));

    function test_factoryDeploymentWithLaunchArgumentOnEmptySepolia() public {
        vm.chainId(11155111);
        vm.etch(SEPOLIA_CORE, hex"");
        DeploymentFactory factory = new DeploymentFactory();
        Hamlock hamlock = factory.deploy(SEPOLIA_CORE);
        assertEq(hamlock.core(), SEPOLIA_CORE);
        assertEq(address(hamlock).balance, 0);
        assertEq(hamlock.totalLocked(), 0);
        assertEq(hamlock.activeJars(), 0);
        (bool ok, uint64 work) = hamlock.currentWork();
        assertFalse(ok);
        assertEq(work, 0);
        assertTrue(address(hamlock).code.length > 0);
        assertLe(address(hamlock).code.length, 24_576);
        assertLe(type(Hamlock).creationCode.length + 32, 49_152);
    }

    function test_constructorRejectsZeroCore() public {
        vm.expectRevert(Hamlock.BadCore.selector);
        new Hamlock(address(0));
    }

    function test_noOwnerAdminPauseUpgradeOrSweepInterface() public {
        Hamlock hamlock = new Hamlock(SEPOLIA_CORE);
        bytes[] memory forbidden = new bytes[](6);
        forbidden[0] = abi.encodeWithSignature("owner()");
        forbidden[1] = abi.encodeWithSignature("admin()");
        forbidden[2] = abi.encodeWithSignature("pause()");
        forbidden[3] = abi.encodeWithSignature("upgradeToAndCall(address,bytes)", address(this), hex"");
        forbidden[4] = abi.encodeWithSignature("sweep(address)", address(this));
        forbidden[5] = abi.encodeWithSignature("transferOwnership(address)", address(this));
        for (uint256 i; i < forbidden.length; ++i) {
            (bool success,) = address(hamlock).call(forbidden[i]);
            assertFalse(success);
        }
    }

    function test_runtimeHasNoDelegatecallCallcodeOrSelfdestruct() public {
        Hamlock hamlock = new Hamlock(SEPOLIA_CORE);
        bytes memory code = address(hamlock).code;
        bool reachable = true;
        // Match the deployment floor's opcode walk: skip PUSH data and unreachable metadata.
        for (uint256 i; i < code.length; ++i) {
            uint8 op = uint8(code[i]);
            if (op == 0x5b) reachable = true;
            if (op >= 0x60 && op <= 0x7f) {
                i += op - 0x5f;
                continue;
            }
            if (reachable) assertTrue(op != 0xf4 && op != 0xf2 && op != 0xff);
            if (op == 0x00 || op == 0x56 || op == 0xf3 || op == 0xfd || op == 0xfe || op == 0xff) {
                reachable = false;
            }
        }
    }
}
