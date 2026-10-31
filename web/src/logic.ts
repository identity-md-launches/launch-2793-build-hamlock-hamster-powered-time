import {
  BaseError,
  ContractFunctionRevertedError,
  formatEther,
  parseEther,
  type Address,
} from "viem";

export type Limits = {
  workPerKm: bigint;
  minKm: number;
  maxKm: number;
  minDeposit: bigint;
  maxDeposit: bigint;
  duration: bigint;
  penaltyBps: bigint;
};
export type Jar = {
  amount: bigint;
  startWork: bigint;
  targetWork: bigint;
  deadline: bigint;
  km: number;
  rewardDebt: bigint;
};
export type Score = {
  owner: Address;
  km: bigint;
  completed: bigint;
  broken: bigint;
};
export const integer = (n: bigint | number) => n.toLocaleString("en-US");
export const eth = (value: bigint) => formatEther(value);
export const compactEth = (value: bigint) => {
  const full = formatEther(value);
  const [whole, fraction = ""] = full.split(".");
  return fraction.length > 6 ? `${whole}.${fraction.slice(0, 6)}…` : full;
};
export const short = (address: string) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;
// Wheel calibration supplied by the brief: one work unit is 0.878 metres.
export const workKm = (work: bigint) =>
  ((Number(work) * 0.878) / 1000).toLocaleString("en-US", {
    maximumFractionDigits: 3,
  });
export function getProgress(
  jar: Jar,
  settled: bigint | null,
  live: bigint | null,
) {
  const target = jar.targetWork - jar.startWork;
  const cap = (work: bigint) =>
    work < 0n ? 0n : work > target ? target : work;
  const done = settled === null ? null : cap(settled - jar.startWork);
  // A live feed can lag settlement. It never erases settled progress or decides eligibility.
  const liveDone =
    live === null || done === null
      ? null
      : cap(live - jar.startWork) > done
        ? cap(live - jar.startWork)
        : done;
  const percent = (value: bigint | null) =>
    value === null || target <= 0n
      ? 0
      : Number((value * 10_000n) / target) / 100;
  return {
    done,
    liveDone,
    settledPercent: percent(done),
    livePercent: percent(liveDone),
    target,
  };
}
export function breakAmounts(amount: bigint, reward: bigint, bps: bigint) {
  const penalty = (amount * bps) / 10_000n;
  return { penalty, refund: amount - penalty, forfeited: reward };
}
export function validateAmount(value: string, limits: Limits): string | null {
  if (
    !/^(?:\d+\.?\d*|\.\d+)$/.test(value) ||
    (value.split(".")[1]?.length ?? 0) > 18
  )
    return "Enter an ETH amount with at most 18 decimal places.";
  try {
    const amount = parseEther(value);
    if (amount < limits.minDeposit || amount > limits.maxDeposit)
      return `Use ${eth(limits.minDeposit)}–${eth(limits.maxDeposit)} Sepolia ETH.`;
    return null;
  } catch {
    return "Enter a valid ETH amount.";
  }
}
export const CONTRACT_ERRORS: Record<string, string> = {
  AlreadyHasJar:
    "You already have a jar. Open or break it before locking again.",
  BadDistance:
    "That distance is outside the contract’s range. Choose a distance on the slider.",
  BadDeposit:
    "That amount is outside the contract’s deposit range. Check the amount and try again.",
  CoreUnavailable:
    "The hamster’s settled data is unavailable. Wait and try again; existing jars still open after their deadline.",
  NoJar: "This wallet has no active jar. Refresh to see its current state.",
  StillLocked:
    "Your jar is still locked. Wait for the settled distance or the deadline.",
  AlreadyOpenable:
    "Your jar can already be opened without a penalty. Use Open jar.",
  TransferFailed:
    "The ETH transfer failed. Check that your wallet can receive ETH, then try again.",
  ReentrantCall:
    "The contract rejected a repeated call. Try one transaction at a time.",
  WorkOverflow:
    "The work counter is beyond the supported range. A new jar cannot be created.",
  DeadlineOverflow:
    "The contract cannot create this deadline. A new jar cannot be created.",
  BadCore: "The core address is invalid.",
  OnlySelf: "This internal contract method is unavailable to wallets.",
};
export function errorMessage(error: unknown): string {
  if (error instanceof BaseError) {
    const revert = error.walk(
      (e) => e instanceof ContractFunctionRevertedError,
    );
    if (
      revert instanceof ContractFunctionRevertedError &&
      revert.data?.errorName
    )
      return (
        CONTRACT_ERRORS[revert.data.errorName] ??
        "The contract declined this transaction. Refresh and try again."
      );
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/reject|denied|4001/i.test(message))
    return "Request declined in your wallet. Nothing was sent; you can try again.";
  if (/insufficient funds|exceeds.*balance/i.test(message))
    return "Your wallet needs more Sepolia ETH for the amount and network fee.";
  if (/chain|network/i.test(message))
    return "Switch your wallet to Sepolia, then try again.";
  for (const [name, text] of Object.entries(CONTRACT_ERRORS))
    if (message.includes(name)) return text;
  return "The request could not be completed. Check your connection, refresh, and try again.";
}
export function countdown(deadline: bigint, now: number) {
  const remaining = Math.max(0, Number(deadline) - Math.floor(now / 1000));
  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;
  return remaining === 0
    ? "Deadline reached"
    : `${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}
export function rankScores(scores: Score[]) {
  return [...scores].sort((a, b) =>
    a.km !== b.km
      ? a.km > b.km
        ? -1
        : 1
      : a.completed !== b.completed
        ? a.completed > b.completed
          ? -1
          : 1
        : a.owner.toLowerCase().localeCompare(b.owner.toLowerCase()),
  );
}
export function shareUrl(km: number) {
  const url = new URL("https://twitter.com/intent/tweet");
  url.searchParams.set(
    "text",
    `I just trusted my ETH to a hamster. It unlocks when @squeektoshi runs ${km} km. #hamlock`,
  );
  url.searchParams.set("url", location.href.split("#")[0]);
  return url.href;
}
