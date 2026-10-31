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
// Use the contract's own work conversion for the displayed settled/live distances.
export const workKm = (work: bigint, workPerKm?: bigint) =>
  workPerKm && workPerKm > 0n
    ? (Number(work) / Number(workPerKm)).toLocaleString("en-US", {
        maximumFractionDigits: 3,
      })
    : "—";
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
    return "enter eth. 18 decimals max.";
  try {
    const amount = parseEther(value);
    if (amount < limits.minDeposit || amount > limits.maxDeposit)
      return `use ${eth(limits.minDeposit)}–${eth(limits.maxDeposit)} sepolia eth.`;
    return null;
  } catch {
    return "enter a valid eth amount.";
  }
}
export const CONTRACT_ERRORS: Record<string, string> = {
  AlreadyHasJar: "already locked. sit tight.",
  BadDistance: "km out of range. use the slider.",
  BadDeposit: "amount out of range. check it and retry.",
  CoreUnavailable:
    "settlement offline. retry later. deadline cash-outs still work.",
  NoJar: "no bag here. refresh your wallet.",
  StillLocked: "still locked. wait for settled km or the deadline.",
  AlreadyOpenable: "already unlocked. use CASH OUT.",
  TransferFailed: "transfer failed. check your wallet can receive eth. retry.",
  ReentrantCall: "repeated call rejected. one transaction at a time.",
  WorkOverflow: "work counter out of range. new locks unavailable.",
  DeadlineOverflow: "deadline out of range. new locks unavailable.",
  BadCore: "invalid core address.",
  OnlySelf: "internal call. unavailable to wallets.",
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
        "contract declined. refresh and retry."
      );
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/reject|denied|4001/i.test(message))
    return "wallet declined. nothing sent. retry when ready.";
  if (/insufficient funds|exceeds.*balance/i.test(message))
    return "need more sepolia eth for the lock and gas.";
  if (/chain|network/i.test(message)) return "switch to sepolia. retry.";
  for (const [name, text] of Object.entries(CONTRACT_ERRORS))
    if (message.includes(name)) return text;
  return "request failed. check your connection and retry.";
}
export function countdown(deadline: bigint, now: number) {
  const remaining = Math.max(0, Number(deadline) - Math.floor(now / 1000));
  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;
  return remaining === 0
    ? "0s"
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
  const url = new URL("https://x.com/intent/tweet");
  url.searchParams.set(
    "text",
    `i trusted my eth to a hamster. it unlocks when @squeektoshi runs ${km} km. #hamlock`,
  );
  url.searchParams.set("url", location.href.split("#")[0]);
  return url.href;
}
