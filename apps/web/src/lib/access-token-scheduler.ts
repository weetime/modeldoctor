import { useAuthStore } from "@/stores/auth-store";
import type { RefreshResult } from "./api-client";

const LEADTIME_MS = 30_000;
const MIN_DELAY_MS = 1_000;

/**
 * Subscribes to the auth store and schedules a setTimeout to call `refreshFn`
 * ~30s before the current access token expires. Reschedules on every store
 * change (login, refresh, logout).
 *
 * Pause/resume on document visibility:
 *  - hidden: clear the timer (the OS may throttle inactive-tab timers anyway,
 *    and there's no UX cost to deferring a background refresh).
 *  - visible: re-evaluate immediately; if we missed the leadtime window
 *    while the tab was hidden, the next setTimeout clamps to MIN_DELAY_MS.
 *
 * Returns a cleanup function. Call it from the app-root useEffect's cleanup.
 */
export function startAccessTokenScheduler(refreshFn: () => Promise<RefreshResult>): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const schedule = (): void => {
    cancel();
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    const { accessTokenExpiresAt } = useAuthStore.getState();
    if (!accessTokenExpiresAt) return;
    const expiresMs = Date.parse(accessTokenExpiresAt);
    if (Number.isNaN(expiresMs)) return;
    const delay = Math.max(MIN_DELAY_MS, expiresMs - Date.now() - LEADTIME_MS);
    timer = setTimeout(() => {
      void refreshFn();
    }, delay);
  };

  const unsubStore = useAuthStore.subscribe(schedule);

  const onVisibility = (): void => {
    if (typeof document === "undefined") return;
    if (document.visibilityState === "visible") schedule();
    else cancel();
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
  }

  // Initial schedule (in case the store was already populated when the
  // scheduler started — e.g. a previously-cached session).
  schedule();

  return (): void => {
    cancel();
    unsubStore();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibility);
    }
  };
}
