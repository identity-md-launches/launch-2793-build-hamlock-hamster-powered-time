import { useEffect, useRef, useState } from "react";
import type { Telemetry } from "./data";
import { isLive, playbackUrl, useBroadcast } from "./live";

export function HamsterCard({
  telemetry,
  pending,
  now,
}: {
  telemetry: Telemetry | null;
  pending: boolean;
  now: number;
}) {
  const broadcast = useBroadcast();
  const [expiredAt, setExpiredAt] = useState(0);
  const live =
    !broadcast.failed &&
    isLive(broadcast.descriptor, Math.max(now, expiredAt, Date.now()));
  const url =
    live && broadcast.descriptor
      ? playbackUrl(broadcast.descriptor.playback, window.location.hostname)
      : null;
  const [selected, setSelected] = useState<string | null>(null);
  const playing = !!url && selected === url;
  const watchRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreWatchFocus = useRef(false);

  useEffect(() => {
    const until = broadcast.descriptor?.validUntil;
    if (!until) return;
    const delay = Date.parse(until) - Date.now();
    if (delay <= 0) return;
    const timer = window.setTimeout(
      () => setExpiredAt(Date.now()),
      Math.min(delay, 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [broadcast.descriptor?.validUntil]);
  useEffect(() => {
    setSelected(null);
  }, [url]);
  useEffect(() => {
    if (playing) closeRef.current?.focus();
    else if (restoreWatchFocus.current) watchRef.current?.focus();
    restoreWatchFocus.current = false;
  }, [playing]);

  return (
    <section className="hamster-panel" aria-labelledby="hamster-title">
      <div className="broadcast-bar">
        <span
          className={`broadcast-badge${live ? " is-live" : ""}`}
          role="status"
        >
          <span aria-hidden="true" />
          {live ? "LIVE" : "OFF AIR"}
        </span>
        {playing ? (
          <button
            ref={closeRef}
            type="button"
            className="stream-button"
            onClick={() => {
              restoreWatchFocus.current = true;
              setSelected(null);
            }}
          >
            close player <span aria-hidden="true">×</span>
          </button>
        ) : live && url ? (
          <button
            ref={watchRef}
            type="button"
            className="stream-button"
            onClick={() => {
              if (isLive(broadcast.descriptor, Date.now())) setSelected(url);
              else setExpiredAt(Date.now());
            }}
          >
            <span aria-hidden="true">▶</span> WATCH LIVE
          </button>
        ) : broadcast.failed || (live && !url) ? (
          <a
            className="stream-button"
            href="https://x.com/squeekchain"
            target="_blank"
            rel="noreferrer"
          >
            watch on x <span aria-hidden="true">↗</span>
          </a>
        ) : null}
      </div>
      <div className="hamster-scene">
        {playing && url ? (
          <iframe
            className="broadcast-player"
            src={url}
            title="squeektoshi live"
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <>
            <img
              src="./hamster.svg"
              width="400"
              height="300"
              alt="pixel hamster in a running wheel"
            />
            <span className="scene-corner top-left" aria-hidden="true" />
            <span className="scene-corner bottom-right" aria-hidden="true" />
          </>
        )}
      </div>
      <div className="hamster-readout">
        <div>
          <h2 id="hamster-title">squeektoshi</h2>
          <p className="small muted">the only validator that eats seeds</p>
        </div>
        <div className="telemetry">
          <span
            className={`telemetry-status${telemetry ? "" : " unavailable"}`}
          >
            <span className="status-dot" aria-hidden="true" />
            {telemetry?.status ?? (pending ? "connecting…" : "data offline")}
          </span>
          <span className="mono small">
            {telemetry
              ? telemetry.rpm.toLocaleString("en-US", {
                  maximumFractionDigits: 3,
                })
              : "—"}{" "}
            rpm
          </span>
        </div>
      </div>
      <div className="hamster-footer">
        <span className="wheel-mood">
          {telemetry?.status === "SPINNING"
            ? "HE'S COOKING"
            : telemetry?.status === "IDLE"
              ? "ASLEEP. COPE."
              : "—"}
        </span>
        {!live && (
          <div className="off-air-details">
            <span className="small muted">
              next zoomies:{" "}
              {broadcast.startAt ? (
                <time
                  dateTime={broadcast.startAt}
                  title={new Date(broadcast.startAt).toLocaleString()}
                  aria-label={new Date(broadcast.startAt).toLocaleString()}
                >
                  {new Date(broadcast.startAt).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                    hourCycle: "h23",
                  })}
                </time>
              ) : broadcast.loading ? (
                "checking…"
              ) : (
                "tbd"
              )}
            </span>
            <a
              href="https://x.com/squeekchain"
              target="_blank"
              rel="noreferrer"
            >
              follow on x <span aria-hidden="true">↗</span>
            </a>
          </div>
        )}
      </div>
    </section>
  );
}
