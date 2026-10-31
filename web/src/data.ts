import { useQuery } from "@tanstack/react-query";
import { getAddress, type Address } from "viem";
import {
  hamlockAbi,
  HAMLOCK,
  publicClient,
  DEPLOYMENT_BLOCK,
  STATUS_URL,
  verifyDeployment,
} from "./chain";
import { rankScores, type Jar, type Limits } from "./logic";

const read = <
  T extends
    | "WORK_PER_KM"
    | "MIN_KM"
    | "MAX_KM"
    | "MIN_DEPOSIT"
    | "MAX_DEPOSIT"
    | "MAX_DURATION"
    | "PENALTY_BPS"
    | "totalLocked"
    | "activeJars"
    | "totalPenalties"
    | "totalBurned"
    | "currentWork",
>(
  functionName: T,
  blockNumber?: bigint,
) =>
  publicClient.readContract({
    address: HAMLOCK,
    abi: hamlockAbi,
    functionName,
    blockNumber,
  });
export function useLimits() {
  return useQuery({
    queryKey: ["limits"],
    queryFn: async (): Promise<Limits> => {
      await verifyDeployment();
      const [
        workPerKm,
        minKm,
        maxKm,
        minDeposit,
        maxDeposit,
        duration,
        penaltyBps,
      ] = await Promise.all([
        read("WORK_PER_KM"),
        read("MIN_KM"),
        read("MAX_KM"),
        read("MIN_DEPOSIT"),
        read("MAX_DEPOSIT"),
        read("MAX_DURATION"),
        read("PENALTY_BPS"),
      ]);
      return {
        workPerKm,
        minKm,
        maxKm,
        minDeposit,
        maxDeposit,
        duration,
        penaltyBps,
      };
    },
    staleTime: Infinity,
    retry: 1,
  });
}
export function useChainState() {
  return useQuery({
    queryKey: ["chain-state"],
    queryFn: async () => {
      const block = await publicClient.getBlock({ blockTag: "latest" });
      const [
        totalLocked,
        activeJars,
        totalPenalties,
        totalBurned,
        currentWork,
      ] = await Promise.all([
        read("totalLocked", block.number),
        read("activeJars", block.number),
        read("totalPenalties", block.number),
        read("totalBurned", block.number),
        read("currentWork", block.number),
      ]);
      return {
        totalLocked,
        activeJars,
        totalPenalties,
        totalBurned,
        currentWork,
        block: block.number,
        timestamp: block.timestamp,
      };
    },
    refetchInterval: 15_000,
    retry: 1,
  });
}
export function useJar(owner?: Address) {
  return useQuery({
    queryKey: ["jar", owner],
    enabled: !!owner,
    queryFn: async () => {
      if (!owner) throw new Error("Connect a wallet first.");
      const block = await publicClient.getBlock({ blockTag: "latest" });
      const params = {
        address: HAMLOCK,
        abi: hamlockAbi,
        args: [owner] as const,
        blockNumber: block.number,
      };
      const [raw, reward, openable, remaining] = await Promise.all([
        publicClient.readContract({ ...params, functionName: "jars" }),
        publicClient.readContract({ ...params, functionName: "pendingReward" }),
        publicClient.readContract({ ...params, functionName: "isOpenable" }),
        publicClient.readContract({ ...params, functionName: "workRemaining" }),
      ]);
      const [amount, startWork, targetWork, deadline, km, rewardDebt] = raw;
      return {
        jar: { amount, startWork, targetWork, deadline, km, rewardDebt } as Jar,
        reward,
        openable,
        remaining,
        timestamp: block.timestamp,
      };
    },
    refetchInterval: 15_000,
    retry: 1,
  });
}
export type Telemetry = {
  work: bigint;
  rpm: number;
  status: "SPINNING" | "IDLE";
  observedAt: string;
  staleAfterSeconds: number;
};
export async function fetchTelemetry(signal?: AbortSignal): Promise<Telemetry> {
  const response = await fetch(STATUS_URL, {
    signal: signal ?? AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Live telemetry is unavailable.");
  const { measurement: m } = await response.json();
  if (
    !m ||
    !["SPINNING", "IDLE"].includes(m.coreStatus) ||
    !/^\d+$/.test(String(m.cumulativeWorkUnits)) ||
    !Number.isFinite(m.rpmMilli) ||
    m.rpmMilli < 0 ||
    !Number.isFinite(m.staleAfterSeconds) ||
    m.staleAfterSeconds <= 0 ||
    !Number.isFinite(Date.parse(m.observedAt)) ||
    m.freshness !== "online" ||
    Date.now() - Date.parse(m.observedAt) > m.staleAfterSeconds * 1000
  )
    throw new Error("Live telemetry is stale or unavailable.");
  return {
    work: BigInt(m.cumulativeWorkUnits),
    rpm: m.rpmMilli / 1000,
    status: m.coreStatus,
    observedAt: m.observedAt,
    staleAfterSeconds: m.staleAfterSeconds,
  };
}
export function useTelemetry() {
  return useQuery({
    queryKey: ["telemetry"],
    queryFn: ({ signal }) =>
      fetchTelemetry(AbortSignal.any([signal, AbortSignal.timeout(10_000)])),
    refetchInterval: 15_000,
    retry: false,
  });
}

// Incremental in-memory index. Re-scan the tail to handle short reorgs; no local leaderboard fiction.
let indexed:
  | {
      through: bigint;
      ownersByLog: Map<string, { owner: Address; block: bigint }>;
    }
  | undefined;
async function loadScores(signal?: AbortSignal) {
  const head = await publicClient.getBlockNumber({ cacheTime: 0 });
  const from = indexed
    ? indexed.through - 12n > DEPLOYMENT_BLOCK
      ? indexed.through - 12n
      : DEPLOYMENT_BLOCK
    : DEPLOYMENT_BLOCK;
  const events = new Map(indexed?.ownersByLog);
  for (const [key, value] of events)
    if (value.block >= from) events.delete(key);
  let cursor = from;
  let chunk = 10_000n;
  while (cursor <= head) {
    signal?.throwIfAborted();
    const toBlock = cursor + chunk - 1n < head ? cursor + chunk - 1n : head;
    try {
      const logs = await publicClient.getContractEvents({
        address: HAMLOCK,
        abi: hamlockAbi,
        eventName: "Opened",
        fromBlock: cursor,
        toBlock,
        strict: true,
      });
      for (const log of logs)
        if (log.args.hamsterRanIt)
          events.set(`${log.transactionHash}:${log.logIndex}`, {
            owner: getAddress(log.args.owner),
            block: log.blockNumber,
          });
      cursor = toBlock + 1n;
    } catch (error) {
      if (chunk <= 100n) throw error;
      chunk /= 2n;
    }
  }
  const owners = [...new Set([...events.values()].map((e) => e.owner))];
  const scores = [];
  // Bounded owner batches keep public RPC requests manageable.
  for (let i = 0; i < owners.length; i += 20) {
    signal?.throwIfAborted();
    scores.push(
      ...(await Promise.all(
        owners.slice(i, i + 20).map(async (owner) => {
          const params = {
            address: HAMLOCK,
            abi: hamlockAbi,
            args: [owner] as const,
            blockNumber: head,
          };
          const [km, completed, broken] = await Promise.all([
            publicClient.readContract({
              ...params,
              functionName: "kmCompleted",
            }),
            publicClient.readContract({
              ...params,
              functionName: "jarsCompleted",
            }),
            publicClient.readContract({
              ...params,
              functionName: "jarsBroken",
            }),
          ]);
          return { owner, km, completed, broken };
        }),
      )),
    );
  }
  indexed = { through: head, ownersByLog: events };
  return { scores: rankScores(scores), through: head };
}
export function useLeaderboard() {
  return useQuery({
    queryKey: ["leaderboard"],
    queryFn: ({ signal }) => loadScores(signal),
    refetchInterval: 60_000,
    staleTime: 45_000,
    retry: 1,
  });
}
