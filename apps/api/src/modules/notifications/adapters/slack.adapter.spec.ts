import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../connection/discovery/ssrf-guard.js", () => ({
  assertSafeUrl: vi.fn(async (url: string) => ({
    safeUrl: new URL(url),
    resolvedIp: "10.0.0.1",
  })),
}));

import { NotificationDeliveryError } from "./index.js";
import { sendSlack } from "./slack.adapter.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => fetchMock.mockReset());

describe("sendSlack", () => {
  it("POSTs { text } payload with formatted message", async () => {
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    await sendSlack("https://hooks.slack.com/services/AAA/BBB/CCC", {
      eventType: "benchmark.completed",
      payload: { name: "bench-1", status: "completed", connectionId: "c1" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.slack.com/services/AAA/BBB/CCC");
    expect(init.method).toBe("POST");
    const parsed = JSON.parse(init.body as string) as { text: string };
    expect(parsed.text).toContain("benchmark.completed");
    expect(parsed.text).toContain("bench-1");
  });

  it("throws NotificationDeliveryError on non-2xx response", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    await expect(
      sendSlack("https://hooks.slack.com/services/X", { eventType: "x", payload: {} }),
    ).rejects.toBeInstanceOf(NotificationDeliveryError);
  });
});
