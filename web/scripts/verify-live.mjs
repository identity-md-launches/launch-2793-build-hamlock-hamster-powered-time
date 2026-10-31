import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, fallback, keccak256, toHex } from "viem";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const deployment = JSON.parse(
  await readFile(resolve(root, "web/deployment.json"), "utf8"),
);
const abi = JSON.parse(
  await readFile(resolve(root, "web/src/abi.json"), "utf8"),
);
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const abiHash = keccak256(toHex(JSON.stringify(canonical(abi))));
if (abiHash !== deployment.abiHash)
  throw new Error("ABI hash differs from the verified deployment");
const urls = [
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://rpc.sepolia.ethpandaops.io",
  "https://sepolia.rpc.sentio.xyz",
];
const client = createPublicClient({
  transport: fallback(
    urls.map((url) => http(url, { timeout: 12000, retryCount: 0 })),
    { retryCount: 0 },
  ),
});
const chainId = await client.getChainId();
if (chainId !== deployment.chainId) throw new Error("Wrong chain");
const bytecode = await client.getCode({ address: deployment.address });
if (!bytecode || keccak256(bytecode) !== deployment.runtimeCodeHash)
  throw new Error("Runtime bytecode differs from compiled, verified source");
const block = await client.getBlockNumber();
const names = [
  "WORK_PER_KM",
  "MIN_KM",
  "MAX_KM",
  "MIN_DEPOSIT",
  "MAX_DEPOSIT",
  "MAX_DURATION",
  "PENALTY_BPS",
  "currentWork",
  "totalLocked",
  "activeJars",
  "totalPenalties",
  "totalBurned",
];
const readings = Object.fromEntries(
  await Promise.all(
    names.map(async (functionName) => [
      functionName,
      await client.readContract({
        address: deployment.address,
        abi,
        functionName,
        blockNumber: block,
      }),
    ]),
  ),
);
const logs = await client.getContractEvents({
  address: deployment.address,
  abi,
  eventName: "Opened",
  fromBlock: BigInt(deployment.deploymentBlock),
  toBlock: block,
});
const apiResponse = await fetch("https://api.squeekchain.com/v1/status", {
  signal: AbortSignal.timeout(15000),
});
const api = apiResponse.ok ? await apiResponse.json() : null;
const result = {
  checkedAt: new Date().toISOString(),
  chainId,
  address: deployment.address,
  abiHash,
  runtimeCodeHash: keccak256(bytecode),
  sourceRuntimeMatch: true,
  block,
  readings,
  openedEvents: logs.length,
  hamsterCompletedEvents: logs.filter((log) => log.args.hamsterRanIt).length,
  api: {
    status: apiResponse.status,
    coreStatus: api?.measurement?.coreStatus ?? null,
    rpmMilli: api?.measurement?.rpmMilli ?? null,
    cumulativeWorkUnits: api?.measurement?.cumulativeWorkUnits ?? null,
    observedAt: api?.measurement?.observedAt ?? null,
  },
  limitations:
    "Read-only verification. No transaction was signed, sent, or deployed.",
};
const json = JSON.stringify(
  result,
  (_, value) => (typeof value === "bigint" ? value.toString() : value),
  2,
);
console.log(json);
const output = process.argv.indexOf("--out");
if (output >= 0) {
  const path = resolve(root, process.argv[output + 1]);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, json + "\n");
}
