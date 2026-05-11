import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../connection/discovery/ssrf-guard.js", () => ({
  assertSafeUrl: vi.fn(async (url: string) => ({
    safeUrl: new URL(url),
    resolvedIp: "10.0.0.1",
  })),
}));

import { sendFeishu } from "./feishu.adapter.js";
import { NotificationDeliveryError } from "./index.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => fetchMock.mockReset());

describe("sendFeishu", () => {
  it("POSTs Feishu schema with [ModelDoctor]-prefixed text", async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"code":0,"msg":"ok"}', { status: 200 }));
    await sendFeishu("https://open.feishu.cn/open-apis/bot/v2/hook/abcd", {
      eventType: "benchmark.completed",
      payload: { name: "bench-1", status: "completed", connectionId: "c1" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsed = JSON.parse(init.body as string) as {
      msg_type: string;
      content: { text: string };
    };
    expect(parsed.msg_type).toBe("text");
    expect(parsed.content.text.startsWith("[ModelDoctor]")).toBe(true);
    expect(parsed.content.text).toContain("benchmark.completed");
    expect(parsed.content.text).toContain("bench-1");
  });

  it("throws when Feishu returns non-zero code in body", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"code":9499,"msg":"param invalid"}', { status: 200 }),
    );
    await expect(
      sendFeishu("https://open.feishu.cn/open-apis/bot/v2/hook/x", {
        eventType: "x",
        payload: {},
      }),
    ).rejects.toBeInstanceOf(NotificationDeliveryError);
  });

  it("throws on 5xx HTTP status", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 503 }));
    await expect(
      sendFeishu("https://open.feishu.cn/open-apis/bot/v2/hook/x", {
        eventType: "x",
        payload: {},
      }),
    ).rejects.toBeInstanceOf(NotificationDeliveryError);
  });

  it("treats non-JSON 200 body as success", async () => {
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    await expect(
      sendFeishu("https://open.feishu.cn/open-apis/bot/v2/hook/x", {
        eventType: "x",
        payload: {},
      }),
    ).resolves.toBeUndefined();
  });
});
