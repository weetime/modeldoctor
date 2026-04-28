import type { RefreshResult } from "./api-client";

const LOCK_NAME = "md-auth-refresh";
const CHANNEL_NAME = "md-auth";

export type AuthChannelMessage =
  | { kind: "ok"; accessToken: string }
  | { kind: "unauthenticated" }
  | { kind: "transient"; status: number };

let inFlight: Promise<RefreshResult> | null = null;
let cachedChannel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (!cachedChannel) cachedChannel = new BroadcastChannel(CHANNEL_NAME);
  return cachedChannel;
}

/**
 * Run `fetcher` under a cross-tab exclusive Web Lock so only one tab actually
 * issues the /auth/refresh network call. The result is broadcast on a
 * BroadcastChannel so other tabs can read it without making their own
 * network call (e.g. in a future enhancement that gates BootGate on a
 * recently-seen broadcast).
 *
 * Falls back to plain promise dedup when navigator.locks is unavailable
 * (older browsers, non-secure contexts). Single-tab dedup is preserved
 * via the module-level inFlight promise.
 */
export async function coordinatedRefresh(
  fetcher: () => Promise<RefreshResult>,
): Promise<RefreshResult> {
  if (inFlight) return inFlight;

  const run = async (): Promise<RefreshResult> => {
    const result = await fetcher();
    const ch = getChannel();
    if (ch) {
      const msg: AuthChannelMessage =
        result.kind === "ok"
          ? { kind: "ok", accessToken: result.accessToken }
          : result.kind === "unauthenticated"
            ? { kind: "unauthenticated" }
            : { kind: "transient", status: result.status };
      ch.postMessage(msg);
    }
    return result;
  };

  const locks = (globalThis.navigator as Navigator & { locks?: LockManager }).locks;
  const p: Promise<RefreshResult> = locks
    ? (locks.request(LOCK_NAME, { mode: "exclusive" }, run) as unknown as Promise<RefreshResult>)
    : run();

  inFlight = p;
  void p.finally(() => {
    if (inFlight === p) inFlight = null;
  });
  return p;
}

/**
 * Subscribe to refresh results from other tabs. Returns an unsubscribe fn.
 * Use from BootGate (Task B6/B7) to short-circuit if another tab refreshed
 * while we were initialising.
 */
export function onRefreshBroadcast(handler: (msg: AuthChannelMessage) => void): () => void {
  const ch = getChannel();
  if (!ch) return () => undefined;
  const listener = (e: MessageEvent): void => handler(e.data as AuthChannelMessage);
  ch.addEventListener("message", listener);
  return (): void => ch.removeEventListener("message", listener);
}
