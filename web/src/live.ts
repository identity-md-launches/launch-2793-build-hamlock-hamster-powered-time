import { useEffect, useState } from "react";

// The two live-service endpoints live together here for easy replacement.
export const LIVE_URL = {
  current: "https://hamlock-live.jubilee-registry.workers.dev/current",
  schedule: "https://hamlock-live.jubilee-registry.workers.dev/schedule",
} as const;

export type LiveDescriptor = {
  schemaVersion: 2;
  state: "idle" | "starting" | "ending" | "live" | "error";
  playback: Record<string, unknown>;
  validUntil: string | null;
};
type Broadcast = {
  descriptor: LiveDescriptor | null;
  startAt: string | null;
  failed: boolean;
  loading: boolean;
};
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isDate = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T/.test(value) &&
  Number.isFinite(Date.parse(value));

export function parseDescriptor(value: unknown): LiveDescriptor {
  if (
    !isObject(value) ||
    value.schemaVersion !== 2 ||
    !["idle", "starting", "ending", "live", "error"].includes(
      String(value.state),
    ) ||
    !isObject(value.playback) ||
    (value.validUntil !== null && !isDate(value.validUntil))
  )
    throw new Error("stream descriptor unavailable");
  return value as LiveDescriptor;
}

export function parseSchedule(value: unknown): string | null {
  if (!isObject(value)) throw new Error("schedule unavailable");
  if (value.occurrence === null) return null;
  if (!isObject(value.occurrence) || !isDate(value.occurrence.startAt))
    throw new Error("schedule unavailable");
  return value.occurrence.startAt;
}

export function isLive(
  descriptor: LiveDescriptor | null,
  now: number,
): boolean {
  return (
    !!descriptor &&
    descriptor.state === "live" &&
    descriptor.validUntil !== null &&
    Date.parse(descriptor.validUntil) > now
  );
}

/** Only fixed provider origins and validated identifiers can become iframe URLs. */
export function playbackUrl(
  playback: Record<string, unknown>,
  hostname: string,
): string | null {
  // Comparing the entire match also refuses a trailing newline (JS's $ allows one).
  const matches = (value: unknown, pattern: RegExp): value is string =>
    typeof value === "string" && value.match(pattern)?.[0] === value;
  if (
    playback.kind === "x" &&
    matches(playback.broadcastId, /^[A-Za-z0-9]{13,16}$/)
  )
    return `https://studio.x.com/embed/broadcast/${playback.broadcastId}?dnt=true`;
  if (
    playback.kind === "youtube" &&
    matches(playback.publicId, /^[A-Za-z0-9_-]{11}$/)
  )
    return `https://www.youtube-nocookie.com/embed/${playback.publicId}?autoplay=1&mute=1`;
  if (
    playback.kind === "twitch" &&
    matches(playback.publicId, /^[a-z0-9_]{4,25}$/)
  )
    return `https://player.twitch.tv/?channel=${playback.publicId}&parent=${encodeURIComponent(hostname)}&muted=true`;
  return null;
}

async function readJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    cache: "no-store",
    credentials: "omit",
  });
  if (!response.ok) throw new Error("stream service unavailable");
  return response.json();
}

export function useBroadcast(): Broadcast {
  const [broadcast, setBroadcast] = useState<Broadcast>({
    descriptor: null,
    startAt: null,
    failed: false,
    loading: true,
  });
  useEffect(() => {
    let controller: AbortController | undefined;
    let timer: number | undefined;
    let fetching = false;
    async function refresh() {
      if (document.visibilityState !== "visible" || fetching) return;
      fetching = true;
      const request = new AbortController();
      controller = request;
      // Schedule failure cannot take down a working broadcast, or vice versa.
      const [current, schedule] = await Promise.allSettled([
        readJson(LIVE_URL.current, request.signal).then(parseDescriptor),
        readJson(LIVE_URL.schedule, request.signal).then(parseSchedule),
      ]);
      if (!request.signal.aborted)
        setBroadcast({
          descriptor: current.status === "fulfilled" ? current.value : null,
          startAt: schedule.status === "fulfilled" ? schedule.value : null,
          failed: current.status === "rejected",
          loading: false,
        });
      if (controller === request) fetching = false;
    }
    function visibilityChanged() {
      window.clearInterval(timer);
      controller?.abort();
      fetching = false;
      if (document.visibilityState === "visible") {
        void refresh();
        timer = window.setInterval(() => void refresh(), 30_000);
      }
    }
    visibilityChanged();
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.clearInterval(timer);
      controller?.abort();
    };
  }, []);
  return broadcast;
}
