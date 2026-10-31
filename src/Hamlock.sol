// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Read-only interface to the SqueekCore proxy on Ethereum Sepolia.
interface ISqueekCore {
    struct CoreState {
        uint64 settledThroughRound;
        uint64 cumulativeWork;
        uint96 cumulativeBlockUnits;
        uint64 blockHeight;
        uint96 blockProgress;
        uint32 workPerThousandBlocks;
        uint256 authorizationNonce;
        bool paused;
    }

    function state() external view returns (CoreState memory);
}

/// @title HAMLOCK
/// @notice Lock Sepolia ETH until Squeektoshi runs a chosen distance, or for at most 30 days.
/// @dev No owner, admin, upgrades or recovery powers. Rewards and principal are paid only to the jar's owner.
contract Hamlock {
    uint64 public constant WORK_PER_KM = 1139;
    uint16 public constant MIN_KM = 1;
    uint16 public constant MAX_KM = 100;
    uint256 public constant MIN_DEPOSIT = 0.001 ether;
    uint256 public constant MAX_DEPOSIT = 1 ether;
    uint256 public constant MAX_DURATION = 30 days;
    uint256 public constant PENALTY_BPS = 2000;
    address public constant BURN = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant REWARD_SCALE = 1e24;

    /// @dev Isolates even a gas-exhausting core upgrade so the deadline escape remains usable.
    uint256 public constant CORE_READ_GAS = 200_000;

    address public immutable core;

    struct Jar {
        uint128 amount;
        uint64 startWork;
        uint64 targetWork;
        uint64 deadline;
        uint16 km;
        uint256 rewardDebt;
    }

    mapping(address => Jar) public jars;
    mapping(address => uint256) public kmCompleted;
    mapping(address => uint256) public jarsCompleted;
    mapping(address => uint256) public jarsBroken;
    uint256 public accRewardPerWei;
    uint256 public totalLocked;
    uint256 public activeJars;
    uint256 public totalPenalties;
    uint256 public totalBurned;

    uint256 private _status = 1;

    error AlreadyHasJar();
    error BadDistance();
    error BadDeposit();
    error CoreUnavailable();
    error NoJar();
    error StillLocked();
    error AlreadyOpenable();
    error TransferFailed();
    error ReentrantCall();
    error BadCore();
    error WorkOverflow();
    error DeadlineOverflow();
    error OnlySelf();

    event Locked(
        address indexed owner, uint256 amount, uint16 km, uint64 startWork, uint64 targetWork, uint64 deadline
    );
    event Opened(address indexed owner, uint256 amount, uint256 reward, bool hamsterRanIt, uint16 km);
    event Broken(address indexed owner, uint256 refund, uint256 penalty, uint256 forfeited, bool burned);

    /// @dev Does not call the dependency or require code at construction (factory-compatible).
    constructor(address core_) {
        if (core_ == address(0)) revert BadCore();
        core = core_;
    }

    modifier nonReentrant() {
        if (_status != 1) revert ReentrantCall();
        _status = 2;
        _;
        _status = 1;
    }

    function lock(uint16 km) external payable nonReentrant {
        if (jars[msg.sender].amount != 0) revert AlreadyHasJar();
        if (km < MIN_KM || km > MAX_KM) revert BadDistance();
        if (msg.value < MIN_DEPOSIT || msg.value > MAX_DEPOSIT) revert BadDeposit();

        (bool ok, uint64 work) = _readCore();
        if (!ok) revert CoreUnavailable();
        uint256 target = uint256(work) + uint256(km) * WORK_PER_KM;
        if (target > type(uint64).max) revert WorkOverflow();
        if (block.timestamp > type(uint64).max - MAX_DURATION) revert DeadlineOverflow();
        uint64 deadline = uint64(block.timestamp + MAX_DURATION);

        uint256 scaledDebt = msg.value * accRewardPerWei;
        // Round UP on entry, DOWN on payout: fractional historical rewards never belong to a new jar.
        uint256 debt = scaledDebt / REWARD_SCALE;
        if (scaledDebt % REWARD_SCALE != 0) debt += 1;

        jars[msg.sender] = Jar({
            amount: uint128(msg.value),
            startWork: work,
            targetWork: uint64(target),
            deadline: deadline,
            km: km,
            rewardDebt: debt
        });
        totalLocked += msg.value;
        activeJars += 1;
        emit Locked(msg.sender, msg.value, km, work, uint64(target), deadline);
    }

    function pendingReward(address owner) public view returns (uint256) {
        Jar storage jar = jars[owner];
        uint256 accrued = uint256(jar.amount) * accRewardPerWei / REWARD_SCALE;
        return accrued > jar.rewardDebt ? accrued - jar.rewardDebt : 0;
    }

    function isOpenable(address owner) public view returns (bool) {
        Jar storage jar = jars[owner];
        if (jar.amount == 0) return false;
        if (block.timestamp >= jar.deadline) return true;
        (bool ok, uint64 work) = _readCore();
        return ok && work >= jar.targetWork;
    }

    /// @notice Remaining wheel turns, not kilometres. Deadline expiry does not imply distance completion.
    function workRemaining(address owner) external view returns (uint64) {
        Jar storage jar = jars[owner];
        if (jar.amount == 0) return 0;
        (bool ok, uint64 work) = _readCore();
        if (!ok || work <= jar.startWork) return jar.targetWork - jar.startWork;
        if (work >= jar.targetWork) return 0;
        return jar.targetWork - work;
    }

    /// @notice A failed read returns (false, 0); zero work with ok=true is a valid reading.
    function currentWork() external view returns (bool ok, uint64 cumulativeWork) {
        return _readCore();
    }

    function open() external nonReentrant {
        Jar memory jar = jars[msg.sender];
        if (jar.amount == 0) revert NoJar();
        (bool ok, uint64 work) = _readCore();
        bool hamsterRanIt = ok && work >= jar.targetWork;
        if (block.timestamp < jar.deadline && !hamsterRanIt) revert StillLocked();

        uint256 reward = pendingReward(msg.sender);
        delete jars[msg.sender];
        totalLocked -= jar.amount;
        activeJars -= 1;
        if (hamsterRanIt) {
            kmCompleted[msg.sender] += jar.km;
            jarsCompleted[msg.sender] += 1;
        }
        emit Opened(msg.sender, jar.amount, reward, hamsterRanIt, jar.km);
        _send(msg.sender, uint256(jar.amount) + reward);
    }

    function breakJar() external nonReentrant {
        Jar memory jar = jars[msg.sender];
        if (jar.amount == 0) revert NoJar();
        if (isOpenable(msg.sender)) revert AlreadyOpenable();

        uint256 forfeited = pendingReward(msg.sender);
        uint256 penalty = uint256(jar.amount) * PENALTY_BPS / 10_000;
        uint256 refund = uint256(jar.amount) - penalty;
        delete jars[msg.sender];
        totalLocked -= jar.amount;
        activeJars -= 1;
        jarsBroken[msg.sender] += 1;

        uint256 toShare = penalty + forfeited;
        totalPenalties += toShare;
        bool burned = totalLocked == 0;
        if (burned) {
            totalBurned += toShare;
        } else {
            accRewardPerWei += toShare * REWARD_SCALE / totalLocked;
        }

        // All accounting is final before either ETH call. Any failed call rolls back the entire break.
        if (burned) _send(BURN, toShare);
        emit Broken(msg.sender, refund, penalty, forfeited, burned);
        _send(msg.sender, refund);
    }

    /// @dev ABI decoding happens in a separate, bounded STATICCALL frame. A direct try core.state()
    /// cannot catch malformed return data decoded in its caller. This helper has no privileges or effects.
    /// Integrations should call currentWork(), which handles failures, instead.
    function readCoreWork() external view returns (uint64) {
        if (msg.sender != address(this)) revert OnlySelf();
        return ISqueekCore(core).state().cumulativeWork;
    }

    /// @dev No dependency failure escapes this wrapper, including missing code or malformed ABI data.
    /// As with every EVM function, the outer transaction still needs sufficient gas to finish.
    function _readCore() internal view returns (bool ok, uint64 cumulativeWork) {
        try this.readCoreWork{gas: CORE_READ_GAS}() returns (uint64 work) {
            return (true, work);
        } catch {
            return (false, 0);
        }
    }

    function _send(address recipient, uint256 value) private {
        (bool sent,) = recipient.call{value: value}("");
        if (!sent) revert TransferFailed();
    }
}
