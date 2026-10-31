import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { chromium, webkit } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import {
  decodeFunctionData,
  encodeFunctionResult,
  encodeEventTopics,
  encodeAbiParameters,
  getAddress,
  keccak256,
  toHex,
  parseEther,
  multicall3Abi,
} from "viem";
import { serveExport } from "./server.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outputDir = resolve(root, "test/scratch/interactions");
await mkdir(outputDir, { recursive: true });
const abi = JSON.parse(
  await readFile(resolve(root, "web/src/abi.json"), "utf8"),
);
const deployment = JSON.parse(
  await readFile(resolve(root, "web/deployment.json"), "utf8"),
);
const runtime = (
  await readFile(
    resolve(root, "web/scripts/fixtures/hamlock-runtime.hex"),
    "utf8",
  )
).trim();
assert.equal(keccak256(runtime), deployment.runtimeCodeHash);
const { address: contract, deploymentBlock } = deployment;
const account = getAddress("0x" + randomBytes(20).toString("hex"));
const ownerA = getAddress("0x" + randomBytes(20).toString("hex"));
const ownerB = getAddress("0x" + randomBytes(20).toString("hex"));
const ownerC = getAddress("0x" + randomBytes(20).toString("hex"));
const blockHash = keccak256(toHex("HAMLOCK validation block (mock only)"));
const txHash = keccak256(toHex("HAMLOCK validation transaction (mock only)"));
const constants = {
  WORK_PER_KM: 1139n,
  MIN_KM: 1,
  MAX_KM: 100,
  MIN_DEPOSIT: parseEther("0.001"),
  MAX_DEPOSIT: parseEther("1"),
  MAX_DURATION: 2592000n,
  PENALTY_BPS: 2000n,
};
const emptyJar = () => [0n, 0n, 0n, 0n, 0, 0n];
const baseState = () => ({
  jar: emptyJar(),
  reward: 0n,
  settled: 58518n,
  coreOk: true,
  live: 59657n,
  rpmMilli: 13500,
  coreStatus: "SPINNING",
  apiDown: false,
  broadcast: {
    schemaVersion: 2,
    state: "idle",
    playback: { kind: "canonical-hls" },
    validUntil: null,
  },
  schedule: {
    occurrence: { startAt: new Date(Date.now() + 3600000).toISOString() },
  },
  streamDown: false,
  scheduleDown: false,
  streamRequests: [],
  embedRequests: [],
  apiStale: false,
  rejectSimulation: null,
  rpcDown: false,
  primaryDown: false,
  chainId: "0xaa36a7",
  openable: false,
  sent: [],
  eventScans: [],
  calls: [],
  readyReceipt: true,
  logs: [],
  scores: new Map(),
  deadline: BigInt(Math.floor(Date.now() / 1000) + 2592000),
});
const activeState = () => ({
  ...baseState(),
  jar: [
    parseEther("0.123456789012345679"),
    57000n,
    68390n,
    BigInt(Math.floor(Date.now() / 1000) + 2592000),
    10,
    0n,
  ],
  reward: parseEther("0.000000000000000019"),
});
function eventLog(
  name,
  owner,
  values,
  index = 0,
  block = BigInt(deploymentBlock + 5),
) {
  const item = abi.find((item) => item.type === "event" && item.name === name);
  return {
    address: contract,
    topics: encodeEventTopics({ abi, eventName: name, args: { owner } }),
    data: encodeAbiParameters(
      item.inputs.filter((input) => !input.indexed),
      values,
    ),
    blockNumber: toHex(block),
    blockHash,
    transactionHash: txHash,
    transactionIndex: "0x0",
    logIndex: toHex(index),
    removed: false,
  };
}
const receipt = (state) => ({
  transactionHash: txHash,
  transactionIndex: "0x0",
  blockHash,
  blockNumber: toHex(BigInt(deploymentBlock + 500)),
  from: account,
  to: contract,
  cumulativeGasUsed: "0x186a0",
  gasUsed: "0x186a0",
  contractAddress: null,
  logs: state.logs,
  logsBloom: "0x" + "00".repeat(256),
  status: "0x1",
  effectiveGasPrice: "0x3b9aca00",
  type: "0x2",
});
function callResult(data, state) {
  try {
    const call = decodeFunctionData({ abi: multicall3Abi, data });
    if (call.functionName === "aggregate3")
      return encodeFunctionResult({
        abi: multicall3Abi,
        functionName: "aggregate3",
        result: call.args[0].map((c) => ({
          success: true,
          returnData: callResult(c.callData, state),
        })),
      });
  } catch {
    /* normal contract call */
  }
  const { functionName: name, args = [] } = decodeFunctionData({ abi, data });
  state.calls.push(name);
  let result = constants[name];
  if (name === "jars") result = state.jar;
  else if (name === "pendingReward") result = state.reward;
  else if (name === "isOpenable") result = state.jar[0] > 0n && state.openable;
  else if (name === "workRemaining")
    result =
      state.jar[0] === 0n
        ? 0n
        : state.settled >= state.jar[2]
          ? 0n
          : state.jar[2] -
            (state.settled > state.jar[1] ? state.settled : state.jar[1]);
  else if (name === "currentWork")
    result = [state.coreOk, state.coreOk ? state.settled : 0n];
  else if (name === "totalLocked") result = state.jar[0];
  else if (name === "activeJars") result = state.jar[0] > 0n ? 1n : 0n;
  else if (name === "totalPenalties" || name === "totalBurned") result = 0n;
  else if (["kmCompleted", "jarsCompleted", "jarsBroken"].includes(name))
    result = (state.scores.get(args[0].toLowerCase()) ?? [0n, 0n, 0n])[
      ["kmCompleted", "jarsCompleted", "jarsBroken"].indexOf(name)
    ];
  else if (name === "lock" || name === "open" || name === "breakJar") {
    if (state.rejectSimulation) {
      const error = abi.find(
        (item) => item.type === "error" && item.name === state.rejectSimulation,
      );
      const signature = keccak256(toHex(`${error.name}()`)).slice(0, 10);
      throw { code: 3, message: "execution reverted", data: signature };
    }
    result = undefined;
  }
  if (result === undefined && !["lock", "open", "breakJar"].includes(name))
    throw Error(`Unhandled contract function ${name}`);
  return encodeFunctionResult({ abi, functionName: name, result });
}
function rpcResult(request, state) {
  const { method, params = [] } = request;
  if (method === "eth_chainId") return "0xaa36a7";
  if (method === "eth_getCode") return runtime;
  if (method === "eth_blockNumber") return toHex(BigInt(deploymentBlock + 500));
  if (method === "eth_getBlockByNumber")
    return {
      number: toHex(BigInt(deploymentBlock + 500)),
      hash: blockHash,
      parentHash: blockHash,
      timestamp: toHex(BigInt(Math.floor(Date.now() / 1000))),
      gasLimit: "0x1c9c380",
      gasUsed: "0x0",
      baseFeePerGas: "0x3b9aca00",
      difficulty: "0x0",
      totalDifficulty: "0x0",
      extraData: "0x",
      logsBloom: "0x" + "00".repeat(256),
      miner: contract,
      mixHash: blockHash,
      nonce: "0x0000000000000000",
      receiptsRoot: blockHash,
      sha3Uncles: blockHash,
      size: "0x1",
      stateRoot: blockHash,
      transactionsRoot: blockHash,
      transactions: [],
      uncles: [],
    };
  if (method === "eth_call") return callResult(params[0].data, state);
  if (method === "eth_getLogs") {
    state.eventScans.push(params[0]);
    return state.events ?? [];
  }
  if (method === "eth_getTransactionReceipt")
    return state.readyReceipt ? receipt(state) : null;
  if (method === "eth_getTransactionByHash")
    return {
      hash: txHash,
      nonce: "0x0",
      blockHash,
      blockNumber: toHex(BigInt(deploymentBlock + 500)),
      transactionIndex: "0x0",
      from: account,
      to: contract,
      value: "0x0",
      gas: "0x186a0",
      gasPrice: "0x3b9aca00",
      input: "0x",
      type: "0x2",
      chainId: "0xaa36a7",
      v: "0x0",
      r: "0x1",
      s: "0x1",
    };
  if (method === "eth_estimateGas") return "0x186a0";
  if (method === "eth_gasPrice" || method === "eth_maxPriorityFeePerGas")
    return "0x3b9aca00";
  throw Error(`Unhandled RPC method ${method}`);
}
async function setup(browser, state = baseState(), options = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ...options.context,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [],
    missing = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.url().startsWith(preview.url) && response.status() >= 400)
      missing.push(response.url());
  });
  await context.route("**/*", async (route) => {
    const req = route.request(),
      url = req.url();
    if (url.includes("/__test__/send")) {
      const tx = req.postDataJSON();
      state.sent.push(tx);
      const { functionName, args = [] } = decodeFunctionData({
        abi,
        data: tx.data,
      });
      if (functionName === "lock") {
        state.jar = [
          BigInt(tx.value),
          state.settled,
          state.settled + BigInt(args[0]) * 1139n,
          state.deadline,
          args[0],
          0n,
        ];
        state.logs = [
          eventLog("Locked", account, [
            state.jar[0],
            args[0],
            state.jar[1],
            state.jar[2],
            state.jar[3],
          ]),
        ];
      } else if (functionName === "open") {
        state.logs = [
          eventLog("Opened", account, [
            state.jar[0],
            state.reward,
            true,
            state.jar[4],
          ]),
        ];
        state.jar = emptyJar();
        state.reward = 0n;
      } else if (functionName === "breakJar") {
        const amount = state.jar[0],
          penalty = (amount * 2000n) / 10000n;
        state.logs = [
          eventLog("Broken", account, [
            amount - penalty,
            penalty,
            state.reward,
            false,
          ]),
        ];
        state.jar = emptyJar();
        state.reward = 0n;
      }
      return route.fulfill({ json: { hash: txHash } });
    }
    if (url.includes("hamlock-live.jubilee-registry.workers.dev")) {
      state.streamRequests.push({ url, at: Date.now() });
      if (url.endsWith("/schedule"))
        return route.fulfill({
          status: state.scheduleDown ? 503 : 200,
          json: state.scheduleDown
            ? { error: "fixture outage" }
            : state.schedule,
        });
      return route.fulfill({
        status: state.streamDown ? 503 : 200,
        json: state.streamDown ? { error: "fixture outage" } : state.broadcast,
      });
    }
    if (/studio\.x\.com|youtube-nocookie\.com|player\.twitch\.tv/.test(url)) {
      state.embedRequests.push(url);
      return route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html lang="en"><head><title>provider fixture</title></head><body><main><p>stream fixture</p></main></body></html>',
      });
    }
    if (url.includes("api.squeekchain.com")) {
      if (state.apiDown)
        return route.fulfill({ status: 503, json: { error: "test outage" } });
      return route.fulfill({
        json: {
          measurement: {
            freshness: "online",
            observedAt: new Date(
              Date.now() - (state.apiStale ? 300000 : 0),
            ).toISOString(),
            staleAfterSeconds: 120,
            coreStatus: state.coreStatus,
            rpmMilli: state.rpmMilli,
            cumulativeWorkUnits: state.live.toString(),
          },
        },
      });
    }
    if (/publicnode|ethpandaops|sentio/.test(url)) {
      if (state.rpcDown || (state.primaryDown && url.includes("publicnode")))
        return route.abort("failed");
      const input = req.postDataJSON();
      const answer = (request) => {
        try {
          return {
            jsonrpc: "2.0",
            id: request.id,
            result: rpcResult(request, state),
          };
        } catch (error) {
          return {
            jsonrpc: "2.0",
            id: request.id,
            error: error.code
              ? error
              : { code: -32603, message: error.message },
          };
        }
      };
      return route.fulfill({
        json: Array.isArray(input) ? input.map(answer) : answer(input),
      });
    }
    if (url.startsWith(preview.url)) return route.continue();
    return route.abort("blockedbyclient");
  });
  if (options.injected !== false)
    await page.addInitScript(
      ({ account, initialChain, id }) => {
        let chainId = initialChain,
          connected = false,
          reject = false;
        const handlers = new Map();
        const emit = (name, payload) => {
          for (const fn of handlers.get(name) ?? []) fn(payload);
        };
        const provider = {
          isMetaMask: true,
          on(name, fn) {
            handlers.set(name, [...(handlers.get(name) ?? []), fn]);
          },
          removeListener(name, fn) {
            handlers.set(
              name,
              (handlers.get(name) ?? []).filter((x) => x !== fn),
            );
          },
          async request({ method, params = [] }) {
            if (method === "eth_chainId") return chainId;
            if (method === "eth_accounts") return connected ? [account] : [];
            if (method === "eth_requestAccounts") {
              if (reject) {
                reject = false;
                throw { code: 4001, message: "User rejected request" };
              }
              connected = true;
              return [account];
            }
            if (method === "wallet_switchEthereumChain") {
              if (window.__wallet.unknownChain) {
                window.__wallet.unknownChain = false;
                throw { code: 4902, message: "Unknown chain" };
              }
              chainId = params[0].chainId;
              emit("chainChanged", chainId);
              return null;
            }
            if (method === "wallet_addEthereumChain") {
              window.__wallet.added = params[0];
              chainId = params[0].chainId;
              emit("chainChanged", chainId);
              return null;
            }
            if (method === "eth_sendTransaction") {
              if (reject) {
                reject = false;
                throw { code: 4001, message: "User rejected request" };
              }
              return (
                await (
                  await fetch("/preview/__test__/send", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify(params[0]),
                  })
                ).json()
              ).hash;
            }
            if (method === "wallet_getCapabilities") return {};
            if (
              method === "wallet_requestPermissions" ||
              method === "wallet_revokePermissions"
            )
              return [];
            throw {
              code: 4200,
              message: `Unsupported mock wallet method ${method}`,
            };
          },
        };
        window.ethereum = provider;
        window.__wallet = {
          setChain(value) {
            chainId = value;
            emit("chainChanged", value);
          },
          rejectNext() {
            reject = true;
          },
          disconnect() {
            connected = false;
            emit("accountsChanged", []);
          },
          unknownChain: false,
          added: null,
        };
        const announce = () => {
          for (const [rdns, name, uuid] of [
            ["io.metamask", "MetaMask", id],
            [
              "io.rabby",
              "Rabby",
              id.replace(/.$/, (last) => (last === "1" ? "2" : "1")),
            ],
          ])
            window.dispatchEvent(
              new CustomEvent("eip6963:announceProvider", {
                detail: {
                  info: {
                    uuid,
                    name,
                    rdns,
                    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><path d="M2 2h24v24H2z" fill="lime"/></svg>',
                  },
                  provider,
                },
              }),
            );
        };
        window.addEventListener("eip6963:requestProvider", announce);
        announce();
      },
      { account, initialChain: state.chainId, id: randomUUID() },
    );
  if (options.clock) await page.clock.install();
  await page.goto(preview.url);
  await page
    .getByRole("button", { name: "LOCK IT", exact: true })
    .waitFor({ state: "visible" });
  if (options.waitLimits !== false)
    await page.waitForFunction(
      () => document.querySelector("#distance")?.getAttribute("max") === "100",
    );
  return {
    page,
    context,
    state,
    errors,
    missing,
    close: () => context.close(),
  };
}
async function connect(page, name = "metamask") {
  await page.locator(".wallet-control").click();
  await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
}
async function check(name, fn) {
  const start = Date.now();
  try {
    const detail = await fn();
    results.push({
      name,
      passed: true,
      durationMs: Date.now() - start,
      ...(detail ? { detail } : {}),
    });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({
      name,
      passed: false,
      durationMs: Date.now() - start,
      error: error.message,
    });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}
const results = [];
const preview = await serveExport(resolve(root, "dist"));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  await check(
    "Exact degen copy, five rules and contract-derived limits",
    async () => {
      const s = await setup(browser);
      try {
        assert.equal(await s.page.locator("h1").textContent(), "HAMLOCK");
        assert.equal(
          await s.page.locator(".hero-tagline").textContent(),
          "your bags. his legs.",
        );
        assert.equal(
          await s.page.locator(".hero-description").textContent(),
          "lock eth. the hamster runs. you get it back. maybe.",
        );
        assert.equal(
          await s.page.locator("#amount-help").textContent(),
          "0.001–1 sepolia eth. testnet. zero real value.",
        );
        assert.deepEqual(
          await s.page.locator(".rules-list p").allTextContents(),
          [
            "lock 0.001–1 sepolia eth. pick 1–100 km.",
            "the counter starts when you lock. when squeektoshi runs your km, you cash out.",
            "break early = you lose 20%. it goes to whoever's still holding. nobody left? burned.",
            "30 days max. then it opens anyway.",
            "no owner. no admin. just a hamster.",
          ],
        );
        await s.page
          .getByText("nobody's finished a run yet. be first.", { exact: true })
          .waitFor();
        assert.equal(
          await s.page.locator(".site-footer p").textContent(),
          "testnet toy. zero real value. not affiliated with squeekchain. it's a hamster, dyor.",
        );
        assert(
          !/little|tiny feet|bottled|simple rules|patience pool|lock keeper/i.test(
            await s.page.locator("body").innerText(),
          ),
        );
      } finally {
        await s.close();
      }
    },
  );
  await check(
    "Off-air schedule uses the visitor's local time; wheel stats remain independent",
    async () => {
      const state = baseState();
      state.coreStatus = "IDLE";
      const s = await setup(browser, state, {
        context: { timezoneId: "America/Los_Angeles" },
      });
      try {
        await s.page.getByText("ASLEEP. COPE.", { exact: true }).waitFor();
        await s.page.locator(".off-air-details time").waitFor();
        assert.equal(
          await s.page.locator(".broadcast-badge").textContent(),
          "OFF AIR",
        );
        assert.equal(
          await s.page
            .locator(".off-air-details time")
            .getAttribute("datetime"),
          state.schedule.occurrence.startAt,
        );
        const localTime = await s.page.evaluate(
          (date) =>
            new Date(date).toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
              hourCycle: "h23",
            }),
          state.schedule.occurrence.startAt,
        );
        assert.equal(
          await s.page.locator(".off-air-details time").textContent(),
          localTime,
        );
        assert.equal(
          await s.page.locator(".telemetry-status").textContent(),
          "IDLE",
        );
        assert.equal(
          await s.page
            .getByRole("link", { name: "follow on x" })
            .getAttribute("href"),
          "https://x.com/squeekchain",
        );
        assert.equal(await s.page.locator("iframe").count(), 0);
        assert.equal(state.embedRequests.length, 0);
        return {
          timeZone: "America/Los_Angeles",
          localTime,
          source: "schedule.occurrence.startAt",
        };
      } finally {
        await s.close();
      }
    },
  );
  await check(
    "X, YouTube and Twitch play on click, keep 16:9 and close back to art with focus",
    async () => {
      const coverage = [];
      for (const [playback, expected] of [
        [
          { kind: "x", broadcastId: "AbCd123456789" },
          "https://studio.x.com/embed/broadcast/AbCd123456789?dnt=true",
        ],
        [
          { kind: "youtube", publicId: "aB_09-cD123" },
          "https://www.youtube-nocookie.com/embed/aB_09-cD123?autoplay=1&mute=1",
        ],
        [{ kind: "twitch", publicId: "hamlock_live" }, null],
      ]) {
        const state = baseState();
        state.broadcast = {
          schemaVersion: 2,
          state: "live",
          playback,
          validUntil: new Date(Date.now() + 120000).toISOString(),
        };
        const s = await setup(browser, state);
        try {
          const watch = s.page.getByRole("button", {
            name: "WATCH LIVE",
            exact: true,
          });
          await watch.waitFor();
          assert.equal(
            await s.page.locator(".broadcast-badge").textContent(),
            "LIVE",
          );
          assert.equal(await s.page.locator("iframe").count(), 0);
          assert.equal(state.embedRequests.length, 0);
          await watch.focus();
          await s.page.keyboard.press("Enter");
          const player = s.page.getByTitle("squeektoshi live", { exact: true });
          await player.waitFor();
          const hostname = new URL(preview.url).hostname;
          assert.equal(
            await player.getAttribute("src"),
            expected ??
              `https://player.twitch.tv/?channel=hamlock_live&parent=${hostname}&muted=true`,
          );
          assert.equal(await s.page.locator(".hamster-scene img").count(), 0);
          const close = s.page.getByRole("button", {
            name: "close player",
            exact: true,
          });
          assert(await close.evaluate((el) => el === document.activeElement));
          for (const width of [320, 390, 800, 1440]) {
            await s.page.setViewportSize({ width, height: 900 });
            const box = await player.boundingBox();
            assert(
              Math.abs(box.width / box.height - 16 / 9) < 0.01,
              `ratio at ${width}`,
            );
            assert(
              await s.page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
            );
          }
          if (playback.kind === "x") {
            await s.page.screenshot({
              path: resolve(outputDir, "1440-player-fixture.png"),
              fullPage: true,
            });
            await s.page.setViewportSize({ width: 390, height: 844 });
            await s.page.locator(".hamster-panel").screenshot({
              path: resolve(outputDir, "390-player-fixture.png"),
            });
          }
          await close.focus();
          await s.page.keyboard.press("Enter");
          assert.equal(await player.count(), 0);
          assert.equal(await s.page.locator(".hamster-scene img").count(), 1);
          assert(await watch.evaluate((el) => el === document.activeElement));
          assert.deepEqual(s.errors, []);
          assert.deepEqual(s.missing, []);
          coverage.push(playback.kind);
        } finally {
          await s.close();
        }
      }
      return {
        coverage,
        responsiveWidths: [320, 390, 800, 1440],
        thirdPartyContent:
          "intercepted provider fixture; no claim of real video playback",
      };
    },
  );
  await check(
    "Every invalid provider identifier is refused before an iframe can be built",
    async () => {
      const state = baseState();
      const invalid = [
        { kind: "x", broadcastId: "A".repeat(12) },
        { kind: "x", broadcastId: "A".repeat(17) },
        { kind: "x", broadcastId: "abcdefghijk_l" },
        { kind: "x", broadcastId: "abcdefghijklm\n" },
        { kind: "x", broadcastId: 1234567890123 },
        { kind: "x", publicId: "AbCd123456789" },
        { kind: "youtube", publicId: "A".repeat(10) },
        { kind: "youtube", publicId: "A".repeat(12) },
        { kind: "youtube", publicId: "abcdefghij/" },
        { kind: "youtube", publicId: "abcdefghijk\n" },
        { kind: "youtube", publicId: null },
        { kind: "twitch", publicId: "abc" },
        { kind: "twitch", publicId: "a".repeat(26) },
        { kind: "twitch", publicId: "UpperCase" },
        { kind: "twitch", publicId: "hamlock&parent=evil" },
        { kind: "twitch", publicId: "hamlock\n" },
        { kind: "twitch", publicId: {} },
        { kind: "canonical-hls", url: "https://evil.example/stream" },
        { kind: "javascript:alert(1)", publicId: "abcdefghijk" },
        {},
      ];
      const s = await setup(browser, state);
      try {
        for (const playback of invalid) {
          state.broadcast = {
            schemaVersion: 2,
            state: "live",
            playback,
            validUntil: new Date(Date.now() + 120000).toISOString(),
          };
          await s.page.reload();
          await s.page
            .getByRole("link", { name: "watch on x", exact: true })
            .waitFor();
          assert.equal(
            await s.page.locator("iframe").count(),
            0,
            JSON.stringify(playback),
          );
          assert.equal(
            await s.page
              .getByRole("button", { name: "WATCH LIVE", exact: true })
              .count(),
            0,
          );
        }
        assert.equal(state.embedRequests.length, 0);
        return { refusedCases: invalid.length };
      } finally {
        await s.close();
      }
    },
  );
  await check("Valid provider ID boundaries are accepted", async () => {
    const state = baseState();
    const s = await setup(browser, state);
    const cases = [
      { kind: "x", broadcastId: "A".repeat(13) },
      { kind: "x", broadcastId: "9".repeat(16) },
      { kind: "youtube", publicId: "_".repeat(11) },
      { kind: "twitch", publicId: "a_09" },
      { kind: "twitch", publicId: "a".repeat(25) },
    ];
    try {
      for (const playback of cases) {
        state.broadcast = {
          schemaVersion: 2,
          state: "live",
          playback,
          validUntil: new Date(Date.now() + 120000).toISOString(),
        };
        await s.page.reload();
        await s.page
          .getByRole("button", { name: "WATCH LIVE", exact: true })
          .click();
        await s.page.locator(".broadcast-player").waitFor();
      }
      return { acceptedCases: cases.length };
    } finally {
      await s.close();
    }
  });
  await check(
    "Only live state with a future validUntil enables watching",
    async () => {
      const state = baseState();
      const s = await setup(browser, state);
      const future = new Date(Date.now() + 120000).toISOString();
      const cases = [
        ...["idle", "starting", "ending", "error"].map((state) => ({
          state,
          validUntil: future,
        })),
        { state: "live", validUntil: null },
        {
          state: "live",
          validUntil: new Date(Date.now() - 1000).toISOString(),
        },
      ];
      try {
        for (const value of cases) {
          state.broadcast = {
            schemaVersion: 2,
            playback: { kind: "x", broadcastId: "AbCd123456789" },
            ...value,
          };
          await s.page.reload();
          await s.page.locator(".off-air-details time").waitFor();
          assert.equal(
            await s.page.locator(".broadcast-badge").textContent(),
            "OFF AIR",
          );
          assert.equal(
            await s.page
              .getByRole("button", { name: "WATCH LIVE", exact: true })
              .count(),
            0,
          );
          assert.equal(await s.page.locator("iframe").count(), 0);
        }
        return { offAirCases: cases.length };
      } finally {
        await s.close();
      }
    },
  );
  await check(
    "Descriptor expiry removes the player without waiting for another poll",
    async () => {
      const state = baseState();
      state.broadcast = {
        schemaVersion: 2,
        state: "live",
        playback: { kind: "x", broadcastId: "AbCd123456789" },
        validUntil: new Date(Date.now() + 5000).toISOString(),
      };
      const s = await setup(browser, state, { clock: true });
      try {
        await s.page
          .getByRole("button", { name: "WATCH LIVE", exact: true })
          .click();
        await s.page.locator("iframe").waitFor();
        const requests = state.streamRequests.length;
        await s.page.clock.fastForward(5500);
        await s.page
          .locator(".broadcast-badge")
          .filter({ hasText: "OFF AIR" })
          .waitFor();
        assert.equal(await s.page.locator("iframe").count(), 0);
        assert.equal(await s.page.locator(".hamster-scene img").count(), 1);
        assert.equal(state.streamRequests.length, requests);
        assert.equal(
          await s.page.locator(".telemetry-status").textContent(),
          "SPINNING",
        );
      } finally {
        await s.close();
      }
    },
  );
  await check(
    "Both endpoints poll every 30 seconds only while visible; visibility return refreshes immediately",
    async () => {
      const s = await setup(browser, baseState(), { clock: true });
      try {
        await s.page.locator(".off-air-details time").waitFor();
        const initial = s.state.streamRequests.length;
        await s.page.clock.fastForward(29000);
        assert.equal(s.state.streamRequests.length, initial);
        await s.page.clock.fastForward(1100);
        await s.page.waitForFunction(
          () => document.querySelector(".off-air-details time") !== null,
        );
        assert.equal(s.state.streamRequests.length, initial + 2);
        await s.page.evaluate(() => {
          window.__visibility = "hidden";
          Object.defineProperty(document, "visibilityState", {
            configurable: true,
            get: () => window.__visibility,
          });
          document.dispatchEvent(new Event("visibilitychange"));
        });
        const beforeHidden = s.state.streamRequests.length;
        await s.page.clock.fastForward(90000);
        assert.equal(s.state.streamRequests.length, beforeHidden);
        s.state.broadcast = {
          schemaVersion: 2,
          state: "live",
          playback: { kind: "youtube", publicId: "aB_09-cD123" },
          validUntil: new Date(Date.now() + 600000).toISOString(),
        };
        await s.page.evaluate(() => {
          window.__visibility = "visible";
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await s.page
          .getByRole("button", { name: "WATCH LIVE", exact: true })
          .waitFor();
        assert.equal(s.state.streamRequests.length, beforeHidden + 2);
        const current = s.state.streamRequests.filter((r) =>
          r.url.endsWith("/current"),
        ).length;
        const schedule = s.state.streamRequests.filter((r) =>
          r.url.endsWith("/schedule"),
        ).length;
        assert.equal(current, schedule);
        return {
          currentRequests: current,
          scheduleRequests: schedule,
          hiddenTimeSimulatedMs: 90000,
        };
      } finally {
        await s.close();
      }
    },
  );
  await check(
    "Ending, provider replacement and a failed poll all remove an open player",
    async () => {
      for (const mode of ["ending", "replacement", "failed"]) {
        const state = baseState();
        state.broadcast = {
          schemaVersion: 2,
          state: "live",
          playback: { kind: "x", broadcastId: "AbCd123456789" },
          validUntil: new Date(Date.now() + 300000).toISOString(),
        };
        const s = await setup(browser, state, { clock: true });
        try {
          await s.page
            .getByRole("button", { name: "WATCH LIVE", exact: true })
            .click();
          await s.page.locator("iframe").waitFor();
          if (mode === "ending") state.broadcast.state = "ending";
          if (mode === "replacement") {
            state.broadcast.playback = {
              kind: "youtube",
              publicId: "aB_09-cD123",
            };
            await s.page.locator("#amount").focus();
          }
          if (mode === "failed") state.streamDown = true;
          await s.page.clock.fastForward(30100);
          await s.page.locator(".hamster-scene img").waitFor();
          assert.equal(await s.page.locator("iframe").count(), 0);
          if (mode === "replacement") {
            await s.page
              .getByRole("button", { name: "WATCH LIVE", exact: true })
              .waitFor();
            assert(
              await s.page
                .locator("#amount")
                .evaluate((el) => el === document.activeElement),
            );
          }
          if (mode === "failed")
            await s.page
              .getByRole("link", { name: "watch on x", exact: true })
              .waitFor();
        } finally {
          await s.close();
        }
      }
    },
  );
  await check(
    "Descriptor failure falls back to X; malformed payloads cannot load an iframe; retry recovers",
    async () => {
      const state = baseState();
      state.streamDown = true;
      const s = await setup(browser, state, { clock: true });
      try {
        const fallback = s.page.getByRole("link", {
          name: "watch on x",
          exact: true,
        });
        await fallback.waitFor();
        assert.equal(
          await fallback.getAttribute("href"),
          "https://x.com/squeekchain",
        );
        await s.page.locator(".off-air-details time").waitFor();
        assert.equal(
          await s.page.locator(".telemetry-status").textContent(),
          "SPINNING",
        );
        state.streamDown = false;
        for (const malformed of [
          null,
          [],
          "not a descriptor",
          { schemaVersion: 1 },
          {
            schemaVersion: 2,
            state: "unknown",
            playback: {},
            validUntil: null,
          },
          {
            schemaVersion: 2,
            state: "live",
            playback: {},
            validUntil: "invalid date",
          },
          { schemaVersion: 2, state: "live", playback: null, validUntil: null },
        ]) {
          state.broadcast = malformed;
          await s.page.clock.fastForward(30100);
          await fallback.waitFor();
          assert.equal(await s.page.locator("iframe").count(), 0);
        }
        state.broadcast = {
          schemaVersion: 2,
          state: "live",
          playback: { kind: "youtube", publicId: "aB_09-cD123" },
          validUntil: new Date(Date.now() + 3600000).toISOString(),
        };
        await s.page.clock.fastForward(30100);
        await s.page
          .getByRole("button", { name: "WATCH LIVE", exact: true })
          .waitFor();
        assert.equal(await fallback.count(), 0);
      } finally {
        await s.close();
      }
    },
  );
  await check(
    "Schedule outage or empty occurrence stays unknown and never suppresses a valid live player",
    async () => {
      for (const mode of ["outage", "none", "invalid", "live"]) {
        const state = baseState();
        state.scheduleDown = mode === "outage" || mode === "live";
        if (mode === "none") state.schedule = { occurrence: null };
        if (mode === "invalid")
          state.schedule = { occurrence: { startAt: "not a date" } };
        if (mode === "live")
          state.broadcast = {
            schemaVersion: 2,
            state: "live",
            playback: { kind: "x", broadcastId: "AbCd123456789" },
            validUntil: new Date(Date.now() + 120000).toISOString(),
          };
        const s = await setup(browser, state);
        try {
          if (mode === "live") {
            await s.page
              .getByRole("button", { name: "WATCH LIVE", exact: true })
              .click();
            await s.page.locator("iframe").waitFor();
          } else {
            await s.page
              .getByText("next zoomies: tbd", { exact: true })
              .waitFor();
            assert.equal(
              await s.page.locator(".off-air-details time").count(),
              0,
            );
            assert.equal(
              await s.page
                .getByRole("link", { name: "watch on x", exact: true })
                .count(),
              0,
            );
          }
        } finally {
          await s.close();
        }
      }
    },
  );
  await check(
    "Live controls and player pass axe; live and off-air badge contrast is measured",
    async () => {
      const state = baseState();
      const s = await setup(browser, state);
      const contrast = async () =>
        s.page.locator(".broadcast-badge").evaluate((el) => {
          const style = getComputedStyle(el);
          const luminance = (css) => {
            const rgb = css
              .match(/[\d.]+/g)
              .slice(0, 3)
              .map(Number)
              .map((v) => {
                const n = v / 255;
                return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
              });
            return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
          };
          const fg = luminance(style.color),
            bg = luminance(style.backgroundColor);
          return {
            label: el.textContent,
            foreground: style.color,
            background: style.backgroundColor,
            ratio: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05),
          };
        });
      try {
        await s.page.locator(".off-air-details time").waitFor();
        const offAir = await contrast();
        assert(offAir.ratio >= 4.5);
        state.broadcast = {
          schemaVersion: 2,
          state: "live",
          playback: { kind: "youtube", publicId: "aB_09-cD123" },
          validUntil: new Date(Date.now() + 120000).toISOString(),
        };
        await s.page.reload();
        await s.page
          .getByRole("button", { name: "WATCH LIVE", exact: true })
          .waitFor();
        const live = await contrast();
        assert(live.ratio >= 4.5);
        for (const playing of [false, true]) {
          if (playing)
            await s.page
              .getByRole("button", { name: "WATCH LIVE", exact: true })
              .click();
          const scan = await new AxeBuilder({ page: s.page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
            .analyze();
          assert.deepEqual(
            scan.violations.map((v) => ({
              id: v.id,
              nodes: v.nodes.map((n) => n.target),
            })),
            [],
          );
        }
        return {
          offAir,
          live,
          axeStates: ["live art", "player fixture"],
          violations: 0,
        };
      } finally {
        await s.close();
      }
    },
  );
  await check(
    "Static subpath assets, metadata, real font loading, mobile first screen",
    async () => {
      const s = await setup(browser);
      try {
        await s.page.evaluate(() => document.fonts.ready);
        const values = await s.page.evaluate(() => ({
          title: document.title,
          description: document.querySelector("meta[name=description]")
            ?.content,
          og: document.querySelector('meta[property="og:image"]')?.content,
          fonts: [
            document.fonts.check("900 64px Doto"),
            document.fonts.check("400 16px Geist"),
          ],
          overflow: document.documentElement.scrollWidth > innerWidth,
          buttonBottom: document
            .querySelector(".lock-button")
            .getBoundingClientRect().bottom,
          height: innerHeight,
        }));
        assert(values.title.includes("HAMLOCK"));
        assert(values.description);
        assert(values.og);
        assert(values.fonts.every(Boolean));
        assert(!values.overflow);
        assert(values.buttonBottom <= values.height);
        assert.deepEqual(s.errors, []);
        assert.deepEqual(s.missing, []);
        await s.page.screenshot({
          path: resolve(outputDir, "390-initial.png"),
          fullPage: true,
        });
        return values;
      } finally {
        await s.close();
      }
    },
  );
  await check(
    "Wallet discovery, rejection, Escape, focus trap and focus return",
    async () => {
      const s = await setup(browser);
      try {
        await s.page.locator(".wallet-control").focus();
        await s.page.keyboard.press("Enter");
        const dialog = s.page.getByRole("dialog");
        await dialog.waitFor();
        assert.equal(
          await dialog.getByRole("button", { name: /browser wallet/ }).count(),
          0,
        );
        assert.equal(
          await dialog.getByRole("button", { name: /^metamask/ }).count(),
          1,
        );
        assert.equal(
          await dialog.getByRole("button", { name: /^rabby/ }).count(),
          1,
        );
        assert.equal(
          await dialog
            .getByRole("button", { name: /^coinbase wallet/ })
            .count(),
          1,
        );
        for (let i = 0; i < 9; i++) {
          await s.page.keyboard.press("Tab");
          assert(
            await s.page.evaluate(() =>
              document.querySelector("dialog").contains(document.activeElement),
            ),
          );
        }
        await s.page.evaluate(() => window.__wallet.rejectNext());
        await dialog.getByRole("button", { name: /^metamask/ }).click();
        await dialog.getByText(/wallet declined/).waitFor();
        await s.page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        assert(
          await s.page
            .locator(".wallet-control")
            .evaluate((el) => el === document.activeElement),
        );
      } finally {
        await s.close();
      }
    },
  );
  await check(
    "No-extension prompt and Coinbase SDK bundle are usable",
    async () => {
      const s = await setup(browser, baseState(), { injected: false });
      try {
        await s.page.locator(".wallet-control").click();
        await s.page
          .getByRole("button", { name: "browser wallet", exact: true })
          .click();
        await s.page.getByText(/no browser wallet/).waitFor();
        await s.page
          .getByRole("button", { name: "coinbase wallet", exact: true })
          .click();
        // Real Coinbase/passkey flow needs an external account; confirm its SDK loads locally.
        await s.page.waitForTimeout(250);
        assert(
          !s.errors.some((error) =>
            /Failed to fetch dynamically imported module|Cannot find|resolve module/i.test(
              error,
            ),
          ),
        );
        assert.deepEqual(s.missing, []);
      } finally {
        await s.close();
      }
    },
  );
  await check(
    "Phone wallet browser links preserve current IPFS subpath",
    async () => {
      const s = await setup(browser, baseState(), {
        injected: false,
        context: {
          userAgent:
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1",
        },
      });
      try {
        await s.page.locator(".wallet-control").click();
        for (const name of ["metamask", "coinbase wallet", "rabby", "phantom"])
          assert(
            await s.page
              .getByRole("link", { name: `open in ${name}` })
              .getAttribute("href"),
          );
        assert.equal(
          await s.page
            .getByRole("button", { name: "coinbase smart wallet", exact: true })
            .count(),
          1,
        );
        assert(
          (
            await s.page
              .getByRole("link", { name: "open in rabby" })
              .getAttribute("href")
          ).includes("_cmd=open-dapp&dapp="),
        );
        assert.equal(
          await s.page
            .getByRole("button", { name: "browser wallet", exact: true })
            .count(),
          0,
        );
        await s.page.screenshot({
          path: resolve(outputDir, "390-wallet-sheet.png"),
        });
      } finally {
        await s.close();
      }
    },
  );
  await check(
    "Wrong network blocks transactions; unknown-chain fallback adds Sepolia",
    async () => {
      const state = baseState();
      state.chainId = "0x1";
      const s = await setup(browser, state);
      try {
        await connect(s.page);
        assert(
          await s.page
            .getByRole("button", { name: "LOCK IT", exact: true })
            .isDisabled(),
        );
        await s.page.evaluate(() => (window.__wallet.unknownChain = true));
        await s.page
          .getByRole("button", { name: "switch to sepolia", exact: true })
          .click();
        await s.page.waitForFunction(() =>
          document.querySelector(".wallet-control")?.textContent.includes("…"),
        );
        const added = await s.page.evaluate(() => window.__wallet.added);
        assert.equal(added.chainId, "0xaa36a7");
        assert.equal(
          added.rpcUrls[0],
          "https://ethereum-sepolia-rpc.publicnode.com",
        );
        assert.equal(added.nativeCurrency.decimals, 18);
        assert.equal(state.sent.length, 0);
      } finally {
        await s.close();
      }
    },
  );
  await check(
    "Amount validation and range math, including exact precision and bounds",
    async () => {
      const s = await setup(browser);
      try {
        const input = s.page.getByLabel("how much", { exact: true });
        for (const value of [
          "0",
          "1.1",
          "-1",
          "1e-3",
          "0.000999999999999999",
          "0.1234567890123456789",
        ]) {
          await input.fill(value);
          await s.page
            .getByRole("button", { name: "LOCK IT", exact: true })
            .click();
          assert.equal(await input.getAttribute("aria-invalid"), "true");
          assert(await input.evaluate((el) => el === document.activeElement));
        }
        await input.fill("0.001");
        await s.page.locator("#distance").fill("100");
        await s.page.getByText("113,900 work units", { exact: true }).waitFor();
        assert.equal(stateSent(s), 0);
      } finally {
        await s.close();
      }
    },
  );
  await check(
    "Lock simulation, wallet submission, confirmation, refreshed jar and X share",
    async () => {
      const s = await setup(browser);
      try {
        await connect(s.page);
        await s.page.locator("#distance").fill("10");
        await s.page.getByLabel("how much", { exact: true }).fill("0.01");
        await s.page
          .getByRole("button", { name: "LOCK IT", exact: true })
          .click();
        await s.page
          .getByText("locked. his problem now.", {
            exact: true,
          })
          .waitFor();
        await s.page
          .getByRole("button", {
            name: "already locked. sit tight.",
            exact: true,
          })
          .waitFor();
        assert.equal(s.state.sent.length, 1);
        assert.equal(s.state.sent[0].to.toLowerCase(), contract);
        assert.equal(BigInt(s.state.sent[0].value), parseEther("0.01"));
        const call = decodeFunctionData({ abi, data: s.state.sent[0].data });
        assert.equal(call.functionName, "lock");
        assert.equal(call.args[0], 10);
        const share = new URL(
          await s.page
            .getByRole("link", { name: "share on x" })
            .getAttribute("href"),
        );
        assert.equal(
          share.searchParams.get("text"),
          "i trusted my eth to a hamster. it unlocks when @squeektoshi runs 10 km. #hamlock",
        );
        assert.equal(share.searchParams.get("url"), preview.url);
        assert(
          await s.page.getByRole("button", { name: /CASH OUT/ }).isDisabled(),
        );
        assert.deepEqual(s.errors, []);
      } finally {
        await s.close();
      }
    },
  );
  await check(
    "Plain-English contract errors prevent sending funds",
    async () => {
      const s = await setup(browser);
      try {
        await connect(s.page);
        for (const [error, text] of [
          ["AlreadyHasJar", "already locked. sit tight."],
          ["BadDistance", "km out of range."],
          ["BadDeposit", "amount out of range."],
          ["CoreUnavailable", "settlement offline."],
          ["NoJar", "no bag here."],
          ["StillLocked", "still locked."],
          ["AlreadyOpenable", "already unlocked."],
          ["TransferFailed", "transfer failed."],
        ]) {
          s.state.rejectSimulation = error;
          await s.page
            .getByRole("button", { name: "LOCK IT", exact: true })
            .click();
          await s.page
            .locator(".transaction-message")
            .filter({ hasText: text })
            .waitFor();
        }
        assert.equal(s.state.sent.length, 0);
      } finally {
        await s.close();
      }
    },
  );
  await check(
    "Settled progress plus lighter live overlay uses the jar baseline",
    async () => {
      const s = await setup(browser, activeState());
      try {
        await connect(s.page);
        const progress = s.page.getByRole("progressbar");
        await progress.waitFor();
        assert.equal(
          await progress.getAttribute("aria-valuetext"),
          "1,518 of 11,390 work units settled",
        );
        const widths = await s.page.evaluate(() => [
          document.querySelector(".settled-progress").style.width,
          document.querySelector(".live-progress").style.width,
        ]);
        assert.equal(widths[0], "13.32%");
        assert(Number.parseFloat(widths[1]) > Number.parseFloat(widths[0]));
        await s.page.getByText(/km live, not settled yet/).waitFor();
        await s.page.getByText("13.5 rpm", { exact: true }).waitFor();
        assert(
          await s.page
            .getByRole("button", { name: "CASH OUT", exact: true })
            .isDisabled(),
        );
        await s.page.screenshot({
          path: resolve(outputDir, "390-active-jar.png"),
          fullPage: true,
        });
      } finally {
        await s.close();
      }
    },
  );
  await check(
    "Break dialog displays wei-exact refund, penalty and reward; cancel preserves jar",
    async () => {
      const s = await setup(browser, activeState());
      try {
        await connect(s.page);
        await s.page
          .getByRole("button", { name: "PAPER HAND IT (-20%)", exact: true })
          .click();
        const dialog = s.page.getByRole("dialog", { name: "paper hand it?" });
        await dialog
          .getByText("0.098765431209876544", { exact: true })
          .waitFor();
        await dialog
          .getByText("0.024691357802469135", { exact: true })
          .waitFor();
        await dialog
          .getByText("0.000000000000000019", { exact: true })
          .waitFor();
        await s.page.screenshot({
          path: resolve(outputDir, "390-break-confirmation.png"),
        });
        await dialog.getByRole("button", { name: "nvm", exact: true }).click();
        assert.equal(s.state.sent.length, 0);
        assert(s.state.jar[0] > 0n);
        await s.page
          .getByRole("button", { name: "PAPER HAND IT (-20%)", exact: true })
          .click();
        await dialog
          .getByRole("button", { name: "do it", exact: true })
          .click();
        await s.page
          .getByText("paper handed. refund returned.", {
            exact: true,
          })
          .waitFor();
        assert.equal(s.state.sent.length, 1);
        assert.equal(
          decodeFunctionData({ abi, data: s.state.sent[0].data }).functionName,
          "breakJar",
        );
      } finally {
        await s.close();
      }
    },
  );
  await check(
    "Changed rewards require renewed break confirmation",
    async () => {
      const s = await setup(browser, activeState());
      try {
        await connect(s.page);
        await s.page
          .getByRole("button", { name: "PAPER HAND IT (-20%)", exact: true })
          .click();
        s.state.reward = parseEther("0.000123");
        await s.page
          .getByRole("button", { name: "do it", exact: true })
          .click();
        await s.page
          .getByText("rewards changed. check the amounts. confirm again.", {
            exact: true,
          })
          .waitFor();
        assert.equal(s.state.sent.length, 0);
        await s.page
          .getByRole("dialog", { name: "paper hand it?" })
          .getByText("0.000123", { exact: true })
          .waitFor();
      } finally {
        await s.close();
      }
    },
  );
  await check(
    "Deadline opening works when the core and API are unavailable",
    async () => {
      const state = activeState();
      state.coreOk = false;
      state.apiDown = true;
      state.openable = true;
      state.jar[3] = BigInt(Math.floor(Date.now() / 1000) - 60);
      const s = await setup(browser, state);
      try {
        await connect(s.page);
        await s.page.locator(".countdown").filter({ hasText: "0s" }).waitFor();
        assert(
          await s.page
            .getByRole("button", { name: "PAPER HAND IT (-20%)", exact: true })
            .isDisabled(),
        );
        await s.page
          .getByRole("button", { name: "CASH OUT", exact: true })
          .click();
        await s.page
          .getByText("cashed out. eth and rewards returned.", { exact: true })
          .waitFor();
        assert.equal(
          decodeFunctionData({ abi, data: s.state.sent[0].data }).functionName,
          "open",
        );
      } finally {
        await s.close();
      }
    },
  );
  await check(
    "API outage and stale API both remove the live overlay",
    async () => {
      for (const mode of ["apiDown", "apiStale"]) {
        const state = activeState();
        state[mode] = true;
        const s = await setup(browser, state);
        try {
          await connect(s.page);
          await s.page.getByText("data offline", { exact: true }).waitFor();
          assert.equal(
            await s.page
              .locator(".live-progress")
              .evaluate((el) => el.style.width),
            "0%",
          );
          assert.equal(
            await s.page
              .getByRole("progressbar")
              .getAttribute("aria-valuetext"),
            "1,518 of 11,390 work units settled",
          );
        } finally {
          await s.close();
        }
      }
    },
  );
  await check(
    "Fallback public RPC and event-derived leaderboard ordering",
    async () => {
      const state = baseState();
      state.primaryDown = true;
      state.events = [
        eventLog("Opened", ownerA, [1n, 0n, true, 20], 0),
        eventLog("Opened", ownerB, [1n, 0n, true, 20], 1),
        eventLog("Opened", ownerC, [1n, 0n, false, 99], 2),
      ];
      state.scores.set(ownerA.toLowerCase(), [20n, 1n, 2n]);
      state.scores.set(ownerB.toLowerCase(), [20n, 2n, 0n]);
      state.scores.set(ownerC.toLowerCase(), [99n, 99n, 99n]);
      const s = await setup(browser, state);
      try {
        await s.page.locator("tbody tr").first().waitFor();
        const rows = await s.page.locator("tbody tr").allTextContents();
        assert.equal(rows.length, 2);
        assert(rows[0].includes(ownerB.slice(0, 6)));
        assert(rows[1].includes(ownerA.slice(0, 6)));
        assert(rows[1].includes("2"));
        assert(state.eventScans.length > 0);
        assert.equal(
          BigInt(state.eventScans[0].fromBlock),
          BigInt(deploymentBlock),
        );
      } finally {
        await s.close();
      }
    },
  );
  await check(
    "Responsive reflow, text enlargement and reduced motion",
    async () => {
      const s = await setup(browser);
      try {
        for (const width of [320, 390, 680, 800, 1440]) {
          await s.page.setViewportSize({ width, height: 900 });
          assert(
            await s.page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            `Overflow at ${width}`,
          );
        }
        await s.page.setViewportSize({ width: 390, height: 844 });
        await s.page.addStyleTag({ content: "html{font-size:200%}" });
        const overflow = await s.page.evaluate(() =>
          [...document.querySelectorAll("body *")]
            .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
            .map((el) => `${el.tagName}.${el.className}`),
        );
        assert(
          await s.page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `Overflow at 200% text enlargement: ${overflow.join(", ")}`,
        );
        await s.page.emulateMedia({ reducedMotion: "reduce" });
        assert.equal(
          await s.page.evaluate(
            () => getComputedStyle(document.documentElement).scrollBehavior,
          ),
          "auto",
        );
        assert.deepEqual(s.errors, []);
      } finally {
        await s.close();
      }
    },
  );
  await check(
    "RPC outage shows unknown values, keeps Connect available and recovers on Retry",
    async () => {
      const state = baseState();
      state.rpcDown = true;
      const s = await setup(browser, state, { waitLimits: false });
      try {
        await s.page
          .getByRole("button", { name: "retry contract reads ↻", exact: true })
          .waitFor({ timeout: 30000 });
        assert(
          await s.page
            .getByRole("button", { name: "LOCK IT", exact: true })
            .isDisabled(),
        );
        assert.equal(
          await s.page.locator(".stat dd").first().textContent(),
          "—eth",
        );
        await s.page.locator(".wallet-control").click();
        await s.page.getByRole("dialog").waitFor();
        await s.page.keyboard.press("Escape");
        state.rpcDown = false;
        await s.page
          .getByRole("button", { name: "retry contract reads ↻", exact: true })
          .click();
        await s.page.getByText("1,139 work units", { exact: true }).waitFor();
        assert(
          !(await s.page
            .getByRole("button", { name: "LOCK IT", exact: true })
            .isDisabled()),
        );
      } finally {
        await s.close();
      }
    },
  );
  await check(
    "Telemetry polls at 15 seconds and an outage removes a previously live overlay",
    async () => {
      const state = activeState();
      const s = await setup(browser, state, { clock: true });
      try {
        await connect(s.page);
        await s.page.getByText("13.5 rpm", { exact: true }).waitFor();
        state.rpmMilli = 21750;
        await s.page.clock.fastForward(15050);
        await s.page.getByText("21.75 rpm", { exact: true }).waitFor();
        state.apiDown = true;
        await s.page.clock.fastForward(15050);
        await s.page.getByText("data offline", { exact: true }).waitFor();
        assert.equal(
          await s.page
            .locator(".live-progress")
            .evaluate((el) => el.style.width),
          "0%",
        );
        assert(
          await s.page
            .getByRole("button", { name: "CASH OUT", exact: true })
            .isDisabled(),
        );
      } finally {
        await s.close();
      }
    },
  );
  await check(
    "Wallet transaction rejection sends nothing and returns the form to idle",
    async () => {
      const s = await setup(browser);
      try {
        await connect(s.page);
        await s.page.evaluate(() => window.__wallet.rejectNext());
        await s.page
          .getByRole("button", { name: "LOCK IT", exact: true })
          .click();
        await s.page
          .getByRole("status")
          .filter({ hasText: "wallet declined." })
          .waitFor();
        assert.equal(s.state.sent.length, 0);
        assert(
          !(await s.page
            .getByRole("button", { name: "LOCK IT", exact: true })
            .isDisabled()),
        );
      } finally {
        await s.close();
      }
    },
  );
  await check(
    "Accessibility scan on the page, wallet dialog, active jar and break dialog",
    async () => {
      const coverage = [];
      for (const active of [false, true]) {
        const s = await setup(browser, active ? activeState() : baseState());
        try {
          if (active) await connect(s.page);
          let scan = await new AxeBuilder({ page: s.page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
            .analyze();
          assert.deepEqual(
            scan.violations.map((v) => ({
              id: v.id,
              impact: v.impact,
              nodes: v.nodes.map((n) => n.target),
            })),
            [],
          );
          coverage.push(active ? "active jar" : "disconnected page");
          await (
            active
              ? s.page.getByRole("button", {
                  name: "PAPER HAND IT (-20%)",
                  exact: true,
                })
              : s.page.locator(".wallet-control")
          ).click();
          scan = await new AxeBuilder({ page: s.page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
            .analyze();
          assert.deepEqual(
            scan.violations.map((v) => ({
              id: v.id,
              impact: v.impact,
              nodes: v.nodes.map((n) => n.target),
            })),
            [],
          );
          coverage.push(active ? "break dialog" : "wallet dialog");
        } finally {
          await s.close();
        }
      }
      return { coverage, violations: 0 };
    },
  );
  if (!process.argv.includes("--offline"))
    await check(
      "Read-only live Sepolia and API smoke on the actual export",
      async () => {
        const context = await browser.newContext({
          viewport: { width: 1440, height: 1000 },
        });
        const page = await context.newPage(),
          errors = [],
          missing = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("response", (r) => {
          if (r.url().startsWith(preview.url) && r.status() >= 400)
            missing.push(r.url());
        });
        try {
          await page.goto(preview.url);
          await page
            .getByText("1,139 work units", { exact: true })
            .waitFor({ timeout: 60000 });
          await page
            .locator(".read-status")
            .filter({ hasText: "block" })
            .waitFor({ timeout: 60000 });
          await page.screenshot({
            path: resolve(outputDir, "1440-live-full.png"),
            fullPage: true,
          });
          await page.setViewportSize({ width: 390, height: 844 });
          await page.screenshot({
            path: resolve(outputDir, "390-live-first.png"),
          });
          assert.deepEqual(errors, []);
          assert.deepEqual(missing, []);
          return {
            poolStatus: await page.locator(".read-status").textContent(),
            hamsterStatus: await page
              .locator(".telemetry-status")
              .textContent(),
          };
        } finally {
          await context.close();
        }
      },
    );
  await check(
    "WebKit mobile form, wallet picker, all three players and close/focus return",
    async () => {
      let wk;
      try {
        wk = await webkit.launch({ headless: true });
      } catch (error) {
        throw new Error(
          `WebKit unavailable: ${error.message.split("\n").filter(Boolean).slice(0, 4).join(" ")}`,
        );
      }
      try {
        const s = await setup(wk);
        try {
          await connect(s.page);
          await s.page.getByLabel("how much", { exact: true }).fill("0");
          await s.page
            .getByRole("button", { name: "LOCK IT", exact: true })
            .click();
          assert.equal(
            await s.page.locator("#amount").getAttribute("aria-invalid"),
            "true",
          );
          assert(
            await s.page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          );
          assert.deepEqual(s.errors, []);
          await s.page.screenshot({
            path: resolve(outputDir, "390-webkit.png"),
          });
          for (const playback of [
            { kind: "x", broadcastId: "AbCd123456789" },
            { kind: "youtube", publicId: "aB_09-cD123" },
            { kind: "twitch", publicId: "hamlock_live" },
          ]) {
            s.state.broadcast = {
              schemaVersion: 2,
              state: "live",
              playback,
              validUntil: new Date(Date.now() + 120000).toISOString(),
            };
            await s.page.reload();
            const watch = s.page.getByRole("button", {
              name: "WATCH LIVE",
              exact: true,
            });
            await watch.click();
            const player = s.page.locator(".broadcast-player");
            await player.waitFor();
            const box = await player.boundingBox();
            assert(Math.abs(box.width / box.height - 16 / 9) < 0.01);
            assert.equal(await s.page.locator(".hamster-scene img").count(), 0);
            await s.page
              .getByRole("button", { name: "close player", exact: true })
              .click();
            assert.equal(await player.count(), 0);
            assert(await watch.evaluate((el) => el === document.activeElement));
          }
          return {
            engine: "WebKit",
            viewport: "390 × 844",
            coverage: [
              "form validation",
              "wallet picker",
              "X player fixture",
              "YouTube player fixture",
              "Twitch player fixture",
              "close and focus return",
            ],
          };
        } finally {
          await s.close();
        }
      } finally {
        await wk.close();
      }
    },
  );
} finally {
  await browser?.close();
  await preview.close();
  const report = {
    checkedAt: new Date().toISOString(),
    target: "dist/ served under /preview/",
    fixtures:
      "Mock accounts are generated per run. Mock RPC/API values are test-only; no transaction is broadcast.",
    results,
    passed: results.filter((r) => r.passed).length,
    total: results.length,
  };
  await mkdir(resolve(root, "docs/checks"), { recursive: true });
  await writeFile(
    resolve(root, "docs/checks/interactions.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(`${report.passed}/${report.total} interaction checks passed`);
  if (results.some((result) => !result.passed)) process.exitCode = 1;
}
function stateSent(session) {
  return session.state.sent.length;
}
