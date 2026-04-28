import { useAuthStore } from "@/stores/auth-store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startAccessTokenScheduler } from "./access-token-scheduler";

const mockUser = { id: "u1", email: "u@x", roles: ["user"], createdAt: new Date().toISOString() };

describe("startAccessTokenScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAuthStore.setState({ accessToken: null, user: null, accessTokenExpiresAt: null });
    Object.defineProperty(document, "visibilityState", {
      writable: true,
      configurable: true,
      value: "visible",
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("schedules refresh ~30s before expiry when store transitions to authenticated", async () => {
    const refreshFn = vi.fn().mockResolvedValue({ kind: "ok", accessToken: "fresh" });
    const stop = startAccessTokenScheduler(refreshFn);

    const expiresAt = new Date(Date.now() + 60_000).toISOString(); // 60s from now
    useAuthStore.setState({ accessToken: "tok", user: mockUser, accessTokenExpiresAt: expiresAt });

    expect(refreshFn).not.toHaveBeenCalled();

    // Fast-forward to 1ms before the scheduled fire moment (expiry - 30s = 30s mark).
    vi.advanceTimersByTime(29_999);
    expect(refreshFn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2);
    await vi.runAllTimersAsync();
    expect(refreshFn).toHaveBeenCalledTimes(1);

    stop();
  });

  it("cancels scheduled refresh when store is cleared (logout)", async () => {
    const refreshFn = vi.fn().mockResolvedValue({ kind: "ok", accessToken: "fresh" });
    const stop = startAccessTokenScheduler(refreshFn);

    useAuthStore.setState({
      accessToken: "tok",
      user: mockUser,
      accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    useAuthStore.setState({ accessToken: null, user: null, accessTokenExpiresAt: null });

    vi.advanceTimersByTime(120_000);
    await vi.runAllTimersAsync();
    expect(refreshFn).not.toHaveBeenCalled();

    stop();
  });

  it("clamps near-instant expiry to a minimum 1s delay (avoid tight loop)", async () => {
    const refreshFn = vi.fn().mockResolvedValue({ kind: "ok", accessToken: "fresh" });
    const stop = startAccessTokenScheduler(refreshFn);

    // Expiry is only 1s away; subtracting the 30s leadtime would be -29s.
    // Scheduler should clamp to MIN_DELAY_MS (1000).
    useAuthStore.setState({
      accessToken: "tok",
      user: mockUser,
      accessTokenExpiresAt: new Date(Date.now() + 1_000).toISOString(),
    });

    expect(refreshFn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(999);
    expect(refreshFn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    await vi.runAllTimersAsync();
    expect(refreshFn).toHaveBeenCalledTimes(1);

    stop();
  });

  it("pauses on visibilitychange='hidden' and resumes on 'visible'", async () => {
    const refreshFn = vi.fn().mockResolvedValue({ kind: "ok", accessToken: "fresh" });
    const stop = startAccessTokenScheduler(refreshFn);

    useAuthStore.setState({
      accessToken: "tok",
      user: mockUser,
      accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    // Now hide the tab. The scheduler should clear its timer.
    Object.defineProperty(document, "visibilityState", {
      writable: true,
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    // Advance past when the timer would have fired.
    vi.advanceTimersByTime(60_000);
    await vi.runAllTimersAsync();
    expect(refreshFn).not.toHaveBeenCalled();

    // Show the tab again. visibilitychange handler should reschedule. Because
    // the original expiry has already passed in the fake-timer timeline, the
    // scheduler clamps to MIN_DELAY_MS (1000) and fires after 1s.
    Object.defineProperty(document, "visibilityState", {
      writable: true,
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    vi.advanceTimersByTime(1_001);
    await vi.runAllTimersAsync();
    expect(refreshFn).toHaveBeenCalledTimes(1);

    stop();
  });
});
