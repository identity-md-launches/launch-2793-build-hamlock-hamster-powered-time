import { useEffect, useRef, useState, type FormEvent } from "react";
import { useConnection, useWalletClient } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { decodeEventLog, getAddress, parseEther, type Hash } from "viem";
import { Wallet } from "./Wallet";
import { Modal } from "./Modal";
import {
  useChainState,
  useJar,
  useLeaderboard,
  useLimits,
  useTelemetry,
} from "./data";
import {
  EXPLORER,
  hamlockAbi,
  HAMLOCK,
  publicClient,
  sepolia,
  SOURCE,
  verifyDeployment,
  DEPLOYMENT_BLOCK,
} from "./chain";
import {
  breakAmounts,
  countdown,
  errorMessage,
  eth,
  getProgress,
  integer,
  shareUrl,
  short,
  validateAmount,
  workKm,
} from "./logic";

const Arrow = () => <span aria-hidden="true">↗</span>;
type Action = "lock" | "open" | "breakJar";
type Transaction = {
  phase: "idle" | "wallet" | "pending" | "success" | "error";
  action?: Action;
  hash?: Hash;
  message?: string;
};

export function App() {
  const { address, isConnected, chainId } = useConnection();
  const { data: walletClient } = useWalletClient();
  const queryClient = useQueryClient();
  const limitsQuery = useLimits();
  const chain = useChainState();
  const jarQuery = useJar(address);
  const telemetry = useTelemetry();
  const leaderboard = useLeaderboard();
  const limits = limitsQuery.data;
  const jarState = jarQuery.data;
  const jar = jarState?.jar;
  const hasJar = !!jar && jar.amount > 0n;
  const [walletOpen, setWalletOpen] = useState(false);
  const [breakOpen, setBreakOpen] = useState(false);
  const [distance, setDistance] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [tx, setTx] = useState<Transaction>({ phase: "idle" });
  const [lastLockedKm, setLastLockedKm] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [leaderPage, setLeaderPage] = useState(0);
  const amountRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const currentAddress = useRef(address);
  currentAddress.current = address;
  const busy = tx.phase === "wallet" || tx.phase === "pending";
  const correctChain = isConnected && chainId === sepolia.id;
  const live =
    telemetry.data &&
    !telemetry.isError &&
    now - Date.parse(telemetry.data.observedAt) <
      telemetry.data.staleAfterSeconds * 1000
      ? telemetry.data
      : null;
  const settled = chain.data?.currentWork[0] ? chain.data.currentWork[1] : null;
  const progress =
    hasJar && jar ? getProgress(jar, settled, live?.work ?? null) : null;
  const km = distance ?? limits?.minKm;
  const penaltyPercent = limits ? Number(limits.penaltyBps) / 100 : null;
  const refundPercent = penaltyPercent === null ? null : 100 - penaltyPercent;
  const payouts =
    limits && hasJar && jarState
      ? breakAmounts(jarState.jar.amount, jarState.reward, limits.penaltyBps)
      : null;
  const staleJar = jarQuery.isError;
  const [previewBreak, setPreviewBreak] = useState<typeof payouts>(null);
  const shareKm = hasJar ? jar?.km : lastLockedKm;
  const canTransact =
    correctChain &&
    !!walletClient &&
    !busy &&
    !!limits &&
    !staleJar &&
    !jarQuery.isPending;
  const coreUnavailable = chain.data && !chain.data.currentWork[0];

  useEffect(() => {
    if (limits) {
      setDistance((value) => value ?? limits.minKm);
      setAmount((value) => value || eth(limits.minDeposit));
    }
  }, [limits]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setBreakOpen(false);
    setPreviewBreak(null);
    setTx({ phase: "idle" });
    setLastLockedKm(null);
  }, [address]);
  useEffect(() => {
    if (!hasJar || !jar || jarState?.openable) return;
    const delay = Number(jar.deadline) * 1000 - Date.now() + 1200;
    const timer = window.setTimeout(
      () => void jarQuery.refetch(),
      Math.max(0, Math.min(delay, 2_147_483_647)),
    );
    return () => clearTimeout(timer);
  }, [hasJar, jar?.deadline, jarState?.openable]);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["chain-state"] }),
      queryClient.invalidateQueries({ queryKey: ["jar"] }),
      queryClient.invalidateQueries({ queryKey: ["leaderboard"] }),
    ]);
  }
  async function transact(action: Action) {
    if (!isConnected) {
      setWalletOpen(true);
      return;
    }
    if (
      !correctChain ||
      !walletClient ||
      !address ||
      !limits ||
      busyRef.current
    )
      return;
    const updateTx = (next: Transaction) => {
      if (currentAddress.current === address) setTx(next);
    };
    busyRef.current = true;
    updateTx({ phase: "wallet", action });
    let sentHash: Hash | undefined;
    try {
      await verifyDeployment();
      if ((await walletClient.getChainId()) !== sepolia.id)
        throw new Error("Wrong chain");
      const common = {
        address: HAMLOCK,
        abi: hamlockAbi,
        account: address,
        chain: sepolia,
      };
      if (action === "lock") {
        if (km === undefined || km < limits.minKm || km > limits.maxKm)
          throw new Error("BadDistance");
        const invalid = validateAmount(amount, limits);
        if (invalid) {
          setAmountError(invalid);
          amountRef.current?.focus();
          updateTx({ phase: "idle" });
          return;
        }
        const { request } = await publicClient.simulateContract({
          ...common,
          functionName: "lock",
          args: [km],
          value: parseEther(amount),
        });
        sentHash = await walletClient.writeContract(request);
      } else {
        if (action === "breakJar") {
          // Refresh exact payouts before asking the wallet. If they changed, ask for confirmation again.
          const current = await jarQuery.refetch();
          if (!current.data || current.isError)
            throw new Error("Unable to refresh jar");
          if (current.data.openable) throw new Error("AlreadyOpenable");
          const latest = breakAmounts(
            current.data.jar.amount,
            current.data.reward,
            limits.penaltyBps,
          );
          if (
            !previewBreak ||
            latest.refund !== previewBreak.refund ||
            latest.forfeited !== previewBreak.forfeited
          ) {
            setPreviewBreak(latest);
            setBreakOpen(true);
            updateTx({
              phase: "idle",
              message:
                "Your reward changed. Review the updated amounts before confirming.",
            });
            return;
          }
        }
        const { request } = await publicClient.simulateContract({
          ...common,
          functionName: action,
        });
        sentHash = await walletClient.writeContract(request);
      }
      setBreakOpen(false);
      updateTx({ phase: "pending", action, hash: sentHash });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: sentHash,
        confirmations: 1,
        timeout: 180_000,
        onReplaced: (replacement) => {
          sentHash = replacement.transaction.hash;
          updateTx({ phase: "pending", action, hash: sentHash });
        },
      });
      if (receipt.status !== "success") throw new Error("Transaction reverted");
      const expectedEvent =
        action === "lock" ? "Locked" : action === "open" ? "Opened" : "Broken";
      const confirmed = receipt.logs.some((log) => {
        if (log.address.toLowerCase() !== HAMLOCK) return false;
        try {
          const event = decodeEventLog({
            abi: hamlockAbi,
            data: log.data,
            topics: log.topics,
          });
          return (
            event.eventName === expectedEvent &&
            "owner" in event.args &&
            event.args.owner?.toLowerCase() === address.toLowerCase()
          );
        } catch {
          return false;
        }
      });
      if (!confirmed)
        throw new Error(
          "The transaction was cancelled or replaced with a different action.",
        );
      if (action === "lock" && currentAddress.current === address)
        setLastLockedKm(km ?? null);
      updateTx({
        phase: "success",
        action,
        hash: receipt.transactionHash,
        message:
          action === "lock"
            ? "Your jar is locked. Squeektoshi takes it from here."
            : action === "open"
              ? "Jar opened. Your ETH and rewards are on their way to your wallet."
              : "Jar broken. Your refund is on its way to your wallet.",
      });
      void refresh();
    } catch (error) {
      updateTx({
        phase: "error",
        action,
        hash: sentHash,
        message: sentHash
          ? "Confirmation could not be completed. Check the transaction on Etherscan before trying again."
          : errorMessage(error),
      });
      void refresh();
    } finally {
      busyRef.current = false;
    }
  }
  function submitLock(event: FormEvent) {
    event.preventDefault();
    if (!limits) return;
    const invalid = validateAmount(amount, limits);
    setAmountError(invalid);
    if (invalid) {
      amountRef.current?.focus();
      return;
    }
    void transact("lock");
  }

  return (
    <>
      <a href="#lock" className="skip-link">
        Skip to lock form
      </a>
      <div className="site-shell">
        <header className="site-header">
          <a href="#" className="brand" aria-label="HAMLOCK home">
            <img src="./favicon.svg" width="28" height="28" alt="" />
            <span>
              HAMLOCK<span className="brand-dot">.</span>
            </span>
          </a>
          <nav className="header-utilities" aria-label="Main navigation">
            <a className="how-link" href="#how-it-works">
              How it works
            </a>
            <span className="network">
              <span className="status-dot" aria-hidden="true" />
              Sepolia
            </span>
            <Wallet open={walletOpen} setOpen={setWalletOpen} />
          </nav>
        </header>
        <main>
          <section className="hero" aria-labelledby="hero-title">
            <div className="hero-copy">
              <h1 id="hero-title">
                HAMLOCK<span className="hero-dot">.</span>
              </h1>
              <p className="hero-description">
                <strong>Lock your ETH.</strong> It opens when Squeektoshi runs
                the distance.
              </p>
            </div>
            <div className="console-grid">
              <section
                className="lock-panel"
                id="lock"
                aria-labelledby="lock-title"
              >
                <div className="section-heading">
                  <h2 id="lock-title">Make a jar</h2>
                  <span className="small muted">Sepolia ETH only</span>
                </div>
                <form onSubmit={submitLock} noValidate>
                  <div className="distance-heading">
                    <label htmlFor="distance">Distance to unlock</label>
                    <output className="distance-value" htmlFor="distance">
                      {km ?? "—"}
                      <span> km</span>
                    </output>
                  </div>
                  <input
                    id="distance"
                    name="distance"
                    type="range"
                    min={limits?.minKm ?? 0}
                    max={limits?.maxKm ?? 0}
                    step="1"
                    value={km ?? 0}
                    disabled={!limits || busy || hasJar}
                    onChange={(e) => setDistance(Number(e.target.value))}
                    aria-describedby="distance-help"
                    style={
                      {
                        "--range-fill":
                          limits && km !== undefined
                            ? `${((km - limits.minKm) / (limits.maxKm - limits.minKm)) * 100}%`
                            : "0%",
                      } as React.CSSProperties
                    }
                  />
                  <div className="range-labels small mono">
                    <span>{limits ? `${limits.minKm} km` : "—"}</span>
                    <span>{limits ? `${limits.maxKm} km` : "—"}</span>
                  </div>
                  <p id="distance-help" className="distance-help small muted">
                    <span className="mono">
                      {limits && km !== undefined
                        ? integer(BigInt(km) * limits.workPerKm)
                        : "—"}{" "}
                      work units
                    </span>
                    <span>A typical active night is about 10 km.</span>
                  </p>
                  <label className="amount-label" htmlFor="amount">
                    Amount to lock
                  </label>
                  <div
                    className={`amount-field${amountError ? " invalid" : ""}`}
                  >
                    <input
                      ref={amountRef}
                      id="amount"
                      name="amount"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={amount}
                      onChange={(e) => {
                        setAmount(e.target.value);
                        setAmountError(null);
                      }}
                      disabled={busy || hasJar}
                      aria-invalid={!!amountError}
                      aria-describedby={
                        amountError ? "amount-error amount-help" : "amount-help"
                      }
                      placeholder={
                        limits ? eth(limits.minDeposit) : "ETH amount"
                      }
                    />
                    <span className="mono">ETH</span>
                  </div>
                  <p id="amount-help" className="small muted">
                    {limits
                      ? `${eth(limits.minDeposit)}–${eth(limits.maxDeposit)} ETH`
                      : "Reading deposit limits…"}
                    <span className="amount-extra">
                      {" "}
                      · Testnet ETH with no real value.
                    </span>
                  </p>
                  {amountError && (
                    <p id="amount-error" className="error small" role="alert">
                      {amountError}
                    </p>
                  )}
                  <button
                    type="submit"
                    className="primary full lock-button"
                    disabled={
                      busy ||
                      hasJar ||
                      !limits ||
                      (!!isConnected && (!canTransact || !!coreUnavailable))
                    }
                  >
                    <span>
                      {busy && tx.action === "lock"
                        ? tx.phase === "wallet"
                          ? "Confirm in your wallet…"
                          : "Locking your ETH…"
                        : hasJar
                          ? "You already have a jar"
                          : "Lock ETH"}
                    </span>
                    <span aria-hidden="true">↗</span>
                  </button>
                  <p className="lock-caption small muted">
                    {hasJar
                      ? "Open or break your current jar to make another."
                      : "Pick the distance. The hamster does the rest."}
                  </p>
                </form>
                {limitsQuery.isError && (
                  <div className="inline-error" role="status">
                    <p>
                      Contract limits could not load. Check your connection.
                    </p>
                    <button
                      className="text-button"
                      onClick={() => limitsQuery.refetch()}
                    >
                      Retry contract reads ↻
                    </button>
                  </div>
                )}
                {isConnected && !correctChain && (
                  <p className="small warning">
                    Switch to Sepolia with the wallet control above.
                  </p>
                )}
                {coreUnavailable && (
                  <p className="small warning">
                    Settled hamster data is unavailable. New locks are paused by
                    the contract; deadline openings still work.
                  </p>
                )}
              </section>
              <section
                className="hamster-panel"
                aria-label="Squeektoshi’s wheel"
              >
                <div className="hamster-scene">
                  <img
                    src="./hamster.svg"
                    width="400"
                    height="300"
                    alt="Pixel art of a small hamster inside a large running wheel"
                  />
                  <span className="scene-corner top-left" aria-hidden="true" />
                  <span
                    className="scene-corner bottom-right"
                    aria-hidden="true"
                  />
                </div>
                <div className="hamster-readout">
                  <div>
                    <h2>Squeektoshi</h2>
                    <p className="small muted">Your very small lock keeper.</p>
                  </div>
                  <div className="telemetry">
                    <span
                      className={`telemetry-status${live ? "" : " unavailable"}`}
                    >
                      <span className="status-dot" aria-hidden="true" />
                      {live?.status ??
                        (telemetry.isPending
                          ? "Connecting…"
                          : "Live unavailable")}
                    </span>
                    <span className="mono small">
                      {live
                        ? live.rpm.toLocaleString("en-US", {
                            maximumFractionDigits: 3,
                          })
                        : "—"}{" "}
                      rpm
                    </span>
                  </div>
                </div>
                <div className="hamster-footer">
                  <a
                    href="https://x.com/squeekchain"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Watch the livestream <Arrow />
                  </a>
                  <span className="small muted">
                    {live
                      ? "Live wheel telemetry"
                      : "Showing settled data only"}
                  </span>
                </div>
              </section>
            </div>
            <div className="hero-footnote">
              <span>
                <span className="mini-lock" aria-hidden="true">
                  ⌑
                </span>{" "}
                No owner, no admin, just a hamster.
              </span>
              <a
                href={`${EXPLORER}/address/${HAMLOCK}#code`}
                target="_blank"
                rel="noreferrer"
              >
                View the contract <Arrow />
              </a>
            </div>
          </section>

          <div
            className={`transaction-message ${tx.phase === "error" ? "error" : ""}`}
            role="status"
            aria-live="polite"
          >
            {tx.phase !== "idle" && (
              <>
                <span>
                  {tx.phase === "wallet"
                    ? "Checking the transaction. Confirm in your wallet when prompted."
                    : tx.phase === "pending"
                      ? "Transaction sent. Waiting for Sepolia confirmation…"
                      : tx.message}
                </span>
                {tx.hash && (
                  <a
                    href={`${EXPLORER}/tx/${tx.hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View transaction <Arrow />
                  </a>
                )}
              </>
            )}
          </div>

          <section
            className="jar-section"
            aria-labelledby="jar-title"
            id="my-jar"
          >
            <div className="section-heading">
              <h2 id="jar-title">My jar</h2>
              <span className="small muted">
                {address ? short(getAddress(address)) : "Your wallet, your jar"}
              </span>
            </div>
            {!isConnected ? (
              <div className="empty-jar">
                <svg
                  width="40"
                  height="48"
                  viewBox="0 0 40 48"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M12 4h16v7h5v5h3v27H4V16h3v-5h5V4ZM10 11h20M13 24h14M20 18v12"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                </svg>
                <div>
                  <h3>A little patience, bottled.</h3>
                  <p className="muted">
                    Connect your wallet to see your jar, its progress, and
                    rewards.
                  </p>
                </div>
                <button
                  className="secondary"
                  onClick={() => setWalletOpen(true)}
                >
                  View my jar <Arrow />
                </button>
              </div>
            ) : jarQuery.isPending ? (
              <p className="state-message muted">
                Reading your jar from Sepolia…
              </p>
            ) : jarQuery.isError && !jarState ? (
              <div className="state-message">
                <p className="warning">
                  Your jar could not load. No funds have moved.
                </p>
                <button
                  className="text-button"
                  onClick={() => jarQuery.refetch()}
                >
                  Retry jar reads ↻
                </button>
              </div>
            ) : !hasJar ? (
              <div className="empty-jar">
                <div>
                  <h3>Your next jar starts here.</h3>
                  <p className="muted">
                    Choose a distance and lock an amount in the form above.
                  </p>
                </div>
                <a className="secondary" href="#lock">
                  Make a jar ↑
                </a>
              </div>
            ) : jar && jarState && progress ? (
              <div className="active-jar">
                {chain.isError && (
                  <p className="warning small">
                    Settled reads failed. Progress shows the last successful
                    chain reading.
                  </p>
                )}
                {staleJar && (
                  <p className="warning small">
                    Jar reads failed. Showing the last reading; actions are
                    paused.{" "}
                    <button
                      className="text-button"
                      onClick={() => jarQuery.refetch()}
                    >
                      Retry
                    </button>
                  </p>
                )}
                <div className="jar-overview">
                  <div>
                    <span className="muted small">Locked principal</span>
                    <p className="amount-value mono">
                      {eth(jar.amount)} <span>ETH</span>
                    </p>
                  </div>
                  <div>
                    <span className="muted small">Chosen distance</span>
                    <p className="amount-value mono">
                      {jar.km} <span>km</span>
                    </p>
                  </div>
                  <div>
                    <span className="muted small">Pending reward</span>
                    <p className="amount-value mono">
                      {eth(jarState.reward)} <span>ETH</span>
                    </p>
                  </div>
                </div>
                <div className="progress-heading">
                  <span>
                    {progress.done === null
                      ? "Settled progress unavailable"
                      : `${workKm(progress.done)} km settled`}
                  </span>
                  <span className="mono small">
                    {progress.done === null ? "—" : integer(progress.done)} /{" "}
                    {integer(progress.target)} work units
                  </span>
                </div>
                <div
                  className="progress-track"
                  role="progressbar"
                  aria-label="Settled jar progress"
                  aria-valuenow={
                    progress.done === null ? undefined : progress.settledPercent
                  }
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuetext={
                    progress.done === null
                      ? "Settled progress unavailable"
                      : `${integer(progress.done)} of ${integer(progress.target)} work units settled`
                  }
                >
                  <span
                    className="live-progress"
                    style={{ width: `${progress.livePercent}%` }}
                  />
                  <span
                    className="settled-progress"
                    style={{ width: `${progress.settledPercent}%` }}
                  />
                </div>
                <div className="progress-legend small">
                  <span>
                    <i className="settled-key" aria-hidden="true" /> Settled on
                    Sepolia
                  </span>
                  {live && progress.liveDone !== null && (
                    <span>
                      <i className="live-key" aria-hidden="true" />{" "}
                      {workKm(progress.liveDone)} km live, not yet settled
                    </span>
                  )}
                </div>
                <p className="small muted">
                  {integer(jarState.remaining)} work units remaining ·{" "}
                  {workKm(jarState.remaining)} km. Distance is work × 0.878 /
                  1,000.
                </p>
                <div className="jar-bottom">
                  <div>
                    <span className="small muted">Automatic deadline</span>
                    <p className="countdown mono">
                      {countdown(jar.deadline, now)}
                    </p>
                    <time
                      className="small muted"
                      dateTime={new Date(
                        Number(jar.deadline) * 1000,
                      ).toISOString()}
                    >
                      {new Date(Number(jar.deadline) * 1000).toLocaleString(
                        "en-US",
                        { dateStyle: "medium", timeStyle: "short" },
                      )}
                    </time>
                  </div>
                  <div className="jar-actions">
                    <button
                      className="primary"
                      type="button"
                      onClick={() => transact("open")}
                      disabled={!canTransact || !jarState.openable}
                    >
                      {busy && tx.action === "open"
                        ? tx.phase === "wallet"
                          ? "Confirm in wallet…"
                          : "Opening…"
                        : "Open jar"}{" "}
                      <Arrow />
                    </button>
                    <button
                      className="danger-button"
                      type="button"
                      onClick={() => {
                        setPreviewBreak(payouts);
                        setBreakOpen(true);
                      }}
                      disabled={!canTransact || jarState.openable}
                    >
                      Break early
                    </button>
                  </div>
                </div>
                <p className="small muted">
                  {jarState.openable
                    ? "Ready to open. Your principal and pending reward are returned together."
                    : "Open when the settled distance is reached or the deadline passes."}
                </p>
                {shareKm !== undefined && shareKm !== null && (
                  <a
                    className="share-link"
                    href={shareUrl(shareKm)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Share on X <Arrow />
                  </a>
                )}
              </div>
            ) : null}
            {!hasJar && lastLockedKm !== null && (
              <a
                className="share-link"
                href={shareUrl(lastLockedKm)}
                target="_blank"
                rel="noreferrer"
              >
                Share on X <Arrow />
              </a>
            )}
          </section>

          <section className="stats-section" aria-labelledby="stats-title">
            <div className="section-heading">
              <h2 id="stats-title">The patience pool</h2>
              <div className="read-status small muted">
                {chain.isError
                  ? "Reads unavailable"
                  : chain.data
                    ? `Block ${integer(chain.data.block)}`
                    : "Reading Sepolia…"}
                <button
                  className="refresh-button"
                  onClick={() => chain.refetch()}
                  disabled={chain.isFetching}
                  aria-label="Refresh pool stats"
                >
                  ↻
                </button>
              </div>
            </div>
            <dl className="stats-grid">
              {[
                [
                  "Total locked",
                  chain.data ? eth(chain.data.totalLocked) : "—",
                  "ETH",
                ],
                [
                  "Active jars",
                  chain.data ? integer(chain.data.activeJars) : "—",
                  "jars",
                ],
                [
                  "Total penalties",
                  chain.data ? eth(chain.data.totalPenalties) : "—",
                  "ETH",
                ],
                [
                  "Total burned",
                  chain.data ? eth(chain.data.totalBurned) : "—",
                  "ETH",
                ],
              ].map(([label, value, unit]) => (
                <div className="stat" key={label}>
                  <dt>{label}</dt>
                  <dd className="mono">
                    {value}
                    <span>{unit}</span>
                  </dd>
                </div>
              ))}
            </dl>
            {chain.isError && (
              <p className="warning small">
                {chain.data
                  ? "Showing the last successful reading."
                  : "No stats available yet."}{" "}
                Public RPCs may be busy. Use refresh to retry.
              </p>
            )}
          </section>

          <section
            className="leaderboard-section"
            aria-labelledby="leaderboard-title"
          >
            <div className="section-heading">
              <h2 id="leaderboard-title">The long run</h2>
              <span className="small muted">Leaderboard</span>
            </div>
            <p className="section-intro muted">
              Ranked by completed kilometres, then completed jars.
            </p>
            <div className="leaderboard">
              <table>
                <caption className="sr-only">
                  Wallets ranked by completed kilometres, then completed jars.
                  Paper hands counts broken jars.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Wallet</th>
                    <th scope="col">km run</th>
                    <th scope="col">Jars</th>
                    <th scope="col">Paper hands</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.data?.scores
                    .slice(leaderPage * 10, (leaderPage + 1) * 10)
                    .map((score, index) => (
                      <tr key={score.owner}>
                        <th scope="row">
                          <span className="rank mono">
                            {leaderPage * 10 + index + 1}
                          </span>
                          <a
                            className="mono"
                            href={`${EXPLORER}/address/${score.owner}`}
                            title={getAddress(score.owner)}
                            aria-label={`Wallet ${getAddress(score.owner)} on Etherscan`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {short(score.owner)} <Arrow />
                          </a>
                        </th>
                        <td className="mono">{integer(score.km)}</td>
                        <td className="mono">{integer(score.completed)}</td>
                        <td className="mono">{integer(score.broken)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {leaderboard.isPending ? (
                <p className="leaderboard-state muted">
                  Scanning the contract’s Opened events…
                </p>
              ) : leaderboard.isError && !leaderboard.data ? (
                <div className="leaderboard-state">
                  <p className="warning">The event history could not load.</p>
                  <button
                    className="text-button"
                    onClick={() => leaderboard.refetch()}
                  >
                    Retry leaderboard ↻
                  </button>
                </div>
              ) : !leaderboard.data?.scores.length ? (
                <div className="leaderboard-state">
                  <span className="pixel-star" aria-hidden="true">
                    ✳
                  </span>
                  <h3>The first finish is still ahead.</h3>
                  <p className="muted">
                    No hamster-completed jars yet. Lock a jar and start your
                    run.
                  </p>
                </div>
              ) : null}
            </div>
            <div className="leaderboard-footer small muted">
              <span>
                From Opened events since block{" "}
                <span className="mono">{integer(DEPLOYMENT_BLOCK)}</span>.
              </span>
              {leaderboard.data && (
                <span>
                  Scanned through{" "}
                  <span className="mono">
                    {integer(leaderboard.data.through)}
                  </span>
                  .
                </span>
              )}
            </div>
            {leaderboard.isError && leaderboard.data && (
              <p className="warning small">
                Leaderboard refresh failed. Showing the last completed scan.{" "}
                <button
                  className="text-button"
                  onClick={() => leaderboard.refetch()}
                >
                  Retry
                </button>
              </p>
            )}
            {!!leaderboard.data && leaderboard.data.scores.length > 10 && (
              <div className="pagination">
                <button
                  className="secondary"
                  disabled={leaderPage === 0}
                  onClick={() => setLeaderPage((value) => value - 1)}
                >
                  ← Previous
                </button>
                <span className="small">
                  {leaderPage + 1} /{" "}
                  {Math.ceil(leaderboard.data.scores.length / 10)}
                </span>
                <button
                  className="secondary"
                  disabled={
                    (leaderPage + 1) * 10 >= leaderboard.data.scores.length
                  }
                  onClick={() => setLeaderPage((value) => value + 1)}
                >
                  Next →
                </button>
              </div>
            )}
          </section>

          <section
            className="rules-section"
            id="how-it-works"
            aria-labelledby="rules-title"
          >
            <div className="rules-heading">
              <h2 id="rules-title">
                Small hamster.
                <br />
                Simple rules.
              </h2>
              <p className="muted">A time lock that runs on tiny feet.</p>
            </div>
            <div className="rules-list">
              <div>
                <h3>Pick your patience.</h3>
                <p className="muted">
                  Lock{" "}
                  {limits
                    ? `${eth(limits.minDeposit)}–${eth(limits.maxDeposit)}`
                    : "…"}{" "}
                  Sepolia ETH for{" "}
                  {limits ? `${limits.minKm}–${limits.maxKm}` : "…"} km.
                  Distance starts counting when you lock, not from Squeektoshi’s
                  lifetime total. One jar per wallet.
                </p>
              </div>
              <div>
                <h3>Let Squeektoshi run.</h3>
                <p className="muted">
                  Your jar opens when your chosen distance settles on Sepolia.
                  After {limits ? integer(limits.duration / 86400n) : "…"} days
                  it opens anyway, even if the hamster takes a holiday. Opening
                  returns your principal plus rewards.
                </p>
              </div>
              <div>
                <h3>Break early, share the cost.</h3>
                <p className="muted">
                  Breaking returns {refundPercent ?? "…"}% of your deposit. The{" "}
                  {penaltyPercent ?? "…"}% penalty and all your earned rewards
                  go to everyone still holding, in proportion to their deposits.
                  If nobody remains, they are burned.
                </p>
              </div>
              <div>
                <h3>No one holds the keys.</h3>
                <p className="muted">
                  No owner, no admin, no overrides. The contract holds your jar;
                  only your wallet can open or break it.
                </p>
              </div>
            </div>
          </section>
        </main>
        <footer className="site-footer">
          <div>
            <a className="brand" href="#">
              <img src="./favicon.svg" width="24" height="24" alt="" />
              HAMLOCK.
            </a>
            <p className="small muted">
              Sepolia testnet game. No real value.
              <br />
              Not affiliated with Squeekchain.
            </p>
          </div>
          <nav aria-label="Project links">
            <a
              href={`${EXPLORER}/address/${HAMLOCK}`}
              target="_blank"
              rel="noreferrer"
            >
              Contract <Arrow />
            </a>
            <a href={SOURCE} target="_blank" rel="noreferrer">
              GitHub source <Arrow />
            </a>
            <a
              href="https://x.com/squeekchain"
              target="_blank"
              rel="noreferrer"
            >
              Squeekchain <Arrow />
            </a>
          </nav>
          <span className="footer-signoff small muted">
            Powered by a hamster.
            <br />
            Held together by patience.
          </span>
        </footer>
      </div>
      <Modal
        open={breakOpen}
        onClose={() => {
          if (!busy) setBreakOpen(false);
        }}
        title="Break your jar?"
      >
        <p className="muted">
          This closes your jar early. You lose part of your deposit and all
          pending rewards.
        </p>
        {previewBreak && (
          <dl className="break-summary">
            <div>
              <dt>You receive ({refundPercent}%)</dt>
              <dd className="mono">{eth(previewBreak.refund)} ETH</dd>
            </div>
            <div>
              <dt>Deposit penalty ({penaltyPercent}%)</dt>
              <dd className="mono">{eth(previewBreak.penalty)} ETH</dd>
            </div>
            <div>
              <dt>Reward forfeited</dt>
              <dd className="mono">{eth(previewBreak.forfeited)} ETH</dd>
            </div>
          </dl>
        )}
        <p className="small muted">
          Amounts exclude the network fee. Rewards can change before
          confirmation. The contract calculates the final amount when mined.
        </p>
        {tx.phase === "idle" && tx.message && (
          <p className="warning small" role="status">
            {tx.message}
          </p>
        )}
        {tx.phase === "error" && (
          <p className="error small" role="status">
            {tx.message}
          </p>
        )}
        <div className="modal-actions">
          <button
            className="secondary"
            type="button"
            disabled={busy}
            onClick={() => setBreakOpen(false)}
          >
            Keep my jar
          </button>
          <button
            className="danger-solid"
            type="button"
            disabled={!canTransact || !previewBreak}
            onClick={() => transact("breakJar")}
          >
            {busy ? "Confirm in wallet…" : `Break jar, lose ${penaltyPercent}%`}
          </button>
        </div>
      </Modal>
    </>
  );
}
