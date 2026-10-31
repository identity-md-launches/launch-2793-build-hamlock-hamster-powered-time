import { useEffect, useRef, useState, type FormEvent } from "react";
import { useConnection, useWalletClient } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { decodeEventLog, getAddress, parseEther, type Hash } from "viem";
import { Wallet } from "./Wallet";
import { Modal } from "./Modal";
import { HamsterCard } from "./HamsterCard";
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
              message: "rewards changed. check the amounts. confirm again.",
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
          "transaction cancelled or replaced with another action.",
        );
      if (action === "lock" && currentAddress.current === address)
        setLastLockedKm(km ?? null);
      updateTx({
        phase: "success",
        action,
        hash: receipt.transactionHash,
        message:
          action === "lock"
            ? "locked. his problem now."
            : action === "open"
              ? "cashed out. eth and rewards returned."
              : "paper handed. refund returned.",
      });
      void refresh();
    } catch (error) {
      updateTx({
        phase: "error",
        action,
        hash: sentHash,
        message: sentHash
          ? "confirmation unknown. check etherscan before retrying."
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
        skip to lock form
      </a>
      <div className="site-shell">
        <header className="site-header">
          <a href="#" className="brand" aria-label="HAMLOCK home">
            <img src="./favicon.svg" width="28" height="28" alt="" />
            <span>
              HAMLOCK<span className="brand-dot">.</span>
            </span>
          </a>
          <nav className="header-utilities" aria-label="main navigation">
            <a className="how-link" href="#how-it-works">
              rules
            </a>
            <span className="network">
              <span className="status-dot" aria-hidden="true" />
              sepolia
            </span>
            <Wallet open={walletOpen} setOpen={setWalletOpen} />
          </nav>
        </header>
        <main>
          <section className="hero" aria-labelledby="hero-title">
            <div className="hero-copy">
              <h1 id="hero-title">HAMLOCK</h1>
              <div>
                <p className="hero-tagline">your bags. his legs.</p>
                <p className="hero-description">
                  lock eth. the hamster runs. you get it back. maybe.
                </p>
              </div>
            </div>
            <div className="console-grid">
              <section
                className="lock-panel"
                id="lock"
                aria-labelledby="lock-title"
              >
                <div className="section-heading">
                  <h2 id="lock-title">lock a bag</h2>
                </div>
                <form onSubmit={submitLock} noValidate>
                  <div className="distance-heading">
                    <label htmlFor="distance">km to unlock</label>
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
                    {" · he does ~10 km on a good night"}
                  </p>
                  <label className="amount-label" htmlFor="amount">
                    how much
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
                        limits ? eth(limits.minDeposit) : "eth amount"
                      }
                    />
                    <span className="mono">eth</span>
                  </div>
                  <p id="amount-help" className="small muted">
                    {limits
                      ? `${eth(limits.minDeposit)}–${eth(limits.maxDeposit)} sepolia eth. testnet. zero real value.`
                      : "reading limits…"}
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
                          ? "confirm in wallet…"
                          : "locking…"
                        : hasJar
                          ? "already locked. sit tight."
                          : "LOCK IT"}
                    </span>
                    <span aria-hidden="true">↗</span>
                  </button>
                </form>
                {limitsQuery.isError && (
                  <div className="inline-error" role="status">
                    <p>contract reads failed.</p>
                    <button
                      className="text-button"
                      onClick={() => limitsQuery.refetch()}
                    >
                      retry contract reads ↻
                    </button>
                  </div>
                )}
                {isConnected && !correctChain && (
                  <p className="small warning">switch to sepolia above.</p>
                )}
                {coreUnavailable && (
                  <p className="small warning">
                    settlement offline. new locks paused. deadline cash-outs
                    still work.
                  </p>
                )}
              </section>
              <HamsterCard
                telemetry={live}
                pending={telemetry.isPending}
                now={now}
              />
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
                    ? "checking. confirm in wallet when prompted."
                    : tx.phase === "pending"
                      ? "sent. waiting on sepolia…"
                      : tx.message}
                </span>
                {tx.hash && (
                  <a
                    href={`${EXPLORER}/tx/${tx.hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    view transaction <Arrow />
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
              <h2 id="jar-title">your bag</h2>
              {address && (
                <span className="small muted mono">
                  {short(getAddress(address))}
                </span>
              )}
            </div>
            {!isConnected ? (
              <div className="empty-jar">
                <p className="muted">connect to see your bag.</p>
                <button
                  className="secondary"
                  onClick={() => setWalletOpen(true)}
                >
                  connect <Arrow />
                </button>
              </div>
            ) : jarQuery.isPending ? (
              <p className="state-message muted">reading your bag…</p>
            ) : jarQuery.isError && !jarState ? (
              <div className="state-message">
                <p className="warning">bag read failed. no transaction sent.</p>
                <button
                  className="text-button"
                  onClick={() => jarQuery.refetch()}
                >
                  retry bag reads ↻
                </button>
              </div>
            ) : !hasJar ? (
              <div className="empty-jar">
                <a className="secondary" href="#lock">
                  lock a bag ↑
                </a>
              </div>
            ) : jar && jarState && progress ? (
              <div className="active-jar">
                {chain.isError && (
                  <p className="warning small">
                    settlement read failed. showing the last read.
                  </p>
                )}
                {staleJar && (
                  <p className="warning small">
                    bag read failed. last read shown. actions paused.{" "}
                    <button
                      className="text-button"
                      onClick={() => jarQuery.refetch()}
                    >
                      retry
                    </button>
                  </p>
                )}
                <div className="jar-overview">
                  <div>
                    <span className="muted small">locked</span>
                    <p className="amount-value mono">
                      {eth(jar.amount)} <span>eth</span>
                    </p>
                  </div>
                  <div>
                    <span className="muted small">km</span>
                    <p className="amount-value mono">
                      {jar.km} <span>km</span>
                    </p>
                  </div>
                  <div>
                    <span className="muted small">
                      rewards from paper hands
                    </span>
                    <p className="amount-value mono">
                      {eth(jarState.reward)} <span>eth</span>
                    </p>
                  </div>
                </div>
                <p className="progress-heading small">
                  {progress.done === null
                    ? "—"
                    : workKm(progress.done, limits?.workPerKm)}{" "}
                  / {jar.km} km settled ·{" "}
                  {progress.liveDone !== null && progress.done !== null
                    ? workKm(
                        progress.liveDone - progress.done,
                        limits?.workPerKm,
                      )
                    : "—"}{" "}
                  km live, not settled yet
                </p>
                <div
                  className="progress-track"
                  role="progressbar"
                  aria-label="settled bag progress"
                  aria-valuenow={
                    progress.done === null ? undefined : progress.settledPercent
                  }
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuetext={
                    progress.done === null
                      ? "settled progress unavailable"
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
                <div className="jar-bottom">
                  <p className="deadline-line muted small">
                    auto-unlock in{" "}
                    <span className="mono countdown">
                      {countdown(jar.deadline, now)}
                    </span>
                    . even hamsters take days off.
                  </p>
                  <div className="jar-actions">
                    <button
                      className="primary"
                      type="button"
                      onClick={() => transact("open")}
                      disabled={!canTransact || !jarState.openable}
                    >
                      {busy && tx.action === "open"
                        ? tx.phase === "wallet"
                          ? "confirm in wallet…"
                          : "cashing out…"
                        : "CASH OUT"}{" "}
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
                      PAPER HAND IT (-{penaltyPercent ?? "…"}%)
                    </button>
                  </div>
                </div>
                {shareKm !== undefined && shareKm !== null && (
                  <a
                    className="share-link"
                    href={shareUrl(shareKm)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    share on x <Arrow />
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
                share on x <Arrow />
              </a>
            )}
          </section>
          <section className="stats-section" aria-labelledby="stats-title">
            <div className="section-heading">
              <h2 id="stats-title">the pot</h2>
              <div className="read-status small muted">
                {chain.isError
                  ? "reads offline"
                  : chain.data
                    ? `block ${integer(chain.data.block)}`
                    : "reading sepolia…"}
                <button
                  className="refresh-button"
                  onClick={() => chain.refetch()}
                  disabled={chain.isFetching}
                  aria-label="refresh pot stats"
                >
                  ↻
                </button>
              </div>
            </div>
            <dl className="stats-grid">
              {[
                [
                  "locked",
                  chain.data ? eth(chain.data.totalLocked) : "—",
                  "eth",
                ],
                [
                  "bags",
                  chain.data ? integer(chain.data.activeJars) : "—",
                  "bags",
                ],
                [
                  "paper hand tax",
                  chain.data ? eth(chain.data.totalPenalties) : "—",
                  "eth",
                ],
                [
                  "burned",
                  chain.data ? eth(chain.data.totalBurned) : "—",
                  "eth",
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
                {chain.data ? "last read shown." : "stats unavailable."} refresh
                to retry.
              </p>
            )}
          </section>
          <section
            className="leaderboard-section"
            aria-labelledby="leaderboard-title"
          >
            <div className="section-heading">
              <h2 id="leaderboard-title">diamond paws</h2>
            </div>
            <div className="leaderboard">
              <table>
                <caption className="sr-only">
                  wallets ranked by km run, then bags completed. paper hands
                  counts early breaks.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">wallet</th>
                    <th scope="col">km run</th>
                    <th scope="col">bags</th>
                    <th scope="col">paper hands</th>
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
                            aria-label={`wallet ${getAddress(score.owner)} on etherscan`}
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
                <p className="leaderboard-state muted">scanning runs…</p>
              ) : leaderboard.isError && !leaderboard.data ? (
                <div className="leaderboard-state">
                  <p className="warning">history read failed.</p>
                  <button
                    className="text-button"
                    onClick={() => leaderboard.refetch()}
                  >
                    retry leaderboard ↻
                  </button>
                </div>
              ) : !leaderboard.data?.scores.length ? (
                <p className="leaderboard-state muted">
                  nobody's finished a run yet. be first.
                </p>
              ) : null}
            </div>
            <div className="leaderboard-footer small muted">
              <span>
                events from block{" "}
                <span className="mono">{integer(DEPLOYMENT_BLOCK)}</span>.
              </span>
              {leaderboard.data && (
                <span>
                  through{" "}
                  <span className="mono">
                    {integer(leaderboard.data.through)}
                  </span>
                  .
                </span>
              )}
            </div>
            {leaderboard.isError && leaderboard.data && (
              <p className="warning small">
                refresh failed. last scan shown.{" "}
                <button
                  className="text-button"
                  onClick={() => leaderboard.refetch()}
                >
                  retry
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
                  ← previous
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
                  next →
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
              <h2 id="rules-title">rules</h2>
            </div>
            <ol className="rules-list">
              <li>
                <p>
                  lock{" "}
                  {limits
                    ? `${eth(limits.minDeposit)}–${eth(limits.maxDeposit)}`
                    : "—"}{" "}
                  sepolia eth. pick{" "}
                  {limits ? `${limits.minKm}–${limits.maxKm}` : "—"} km.
                </p>
              </li>
              <li>
                <p>
                  the counter starts when you lock. when squeektoshi runs your
                  km, you cash out.
                </p>
              </li>
              <li>
                <p>
                  break early = you lose {penaltyPercent ?? "—"}%. it goes to
                  whoever's still holding. nobody left? burned.
                </p>
              </li>
              <li>
                <p>
                  {limits ? integer(limits.duration / 86400n) : "—"} days max.
                  then it opens anyway.
                </p>
              </li>
              <li>
                <p>no owner. no admin. just a hamster.</p>
              </li>
            </ol>
          </section>
        </main>
        <footer className="site-footer">
          <p className="small muted">
            testnet toy. zero real value. not affiliated with squeekchain. it's
            a hamster, dyor.
          </p>
          <nav aria-label="project links">
            <a
              href={`${EXPLORER}/address/${HAMLOCK}#code`}
              target="_blank"
              rel="noreferrer"
            >
              contract <Arrow />
            </a>
            <a href={SOURCE} target="_blank" rel="noreferrer">
              source <Arrow />
            </a>
          </nav>
        </footer>
      </div>
      <Modal
        open={breakOpen}
        onClose={() => {
          if (!busy) setBreakOpen(false);
        }}
        title="paper hand it?"
      >
        {previewBreak && (
          <p className="break-copy">
            you get <span className="mono">{eth(previewBreak.refund)}</span> eth
            back. <span className="mono">{eth(previewBreak.penalty)}</span> +{" "}
            <span className="mono">{eth(previewBreak.forfeited)}</span> goes to
            the people with spines. sure?
          </p>
        )}
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
            nvm
          </button>
          <button
            className="danger-solid"
            type="button"
            disabled={!canTransact || !previewBreak}
            onClick={() => transact("breakJar")}
          >
            {busy ? "confirm in wallet…" : "do it"}
          </button>
        </div>
      </Modal>
    </>
  );
}
