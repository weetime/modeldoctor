import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../connection/discovery/ssrf-guard.js", () => ({
  assertSafeUrl: vi.fn(async (url: string) => ({
    safeUrl: new URL(url),
    resolvedIp: "10.0.0.1",
  })),
}));

import { NotificationDeliveryError } from "./index.js";
import { sendWebhook } from "./webhook.adapter.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => fetchMock.mockReset());

describe("sendWebhook", () => {
  it("POSTs full DeliveryPayload as JSON", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 }));
    await sendWebhook("https://example.test/hook", {
      eventType: "benchmark.failed",
      payload: { name: "bench-x", reason: "timeout" },
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsed = JSON.parse(init.body as string) as {
      eventType: string;
      payload: { reason: string };
    };
    expect(parsed.eventType).toBe("benchmark.failed");
    expect(parsed.payload.reason).toBe("timeout");
  });

  it("throws on 4xx", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    await expect(
      sendWebhook("https://example.test/hook", { eventType: "x", payload: {} }),
    ).rejects.toBeInstanceOf(NotificationDeliveryError);
  });
});
