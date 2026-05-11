import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../connection/discovery/ssrf-guard.js", () => ({
  assertSafeUrl: vi.fn(async (url: string) => ({
    safeUrl: new URL(url),
    resolvedIp: "10.0.0.1",
  })),
}));

import { sendDingtalk } from "./dingtalk.adapter.js";
import { NotificationDeliveryError } from "./index.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => fetchMock.mockReset());

describe("sendDingtalk", () => {
  it("POSTs DingTalk schema with [ModelDoctor]-prefixed content", async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"errcode":0,"errmsg":"ok"}', { status: 200 }));
    await sendDingtalk("https://oapi.dingtalk.com/robot/send?access_token=xxx", {
      eventType: "diagnostics.failed",
      payload: { runId: "r-1", connectionId: "c1" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const parsed = JSON.parse(init.body as string) as {
      msgtype: string;
      text: { content: string };
    };
    expect(parsed.msgtype).toBe("text");
    expect(parsed.text.content.startsWith("[ModelDoctor]")).toBe(true);
    expect(parsed.text.content).toContain("diagnostics.failed");
  });

  it("throws when DingTalk returns non-zero errcode in body", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"errcode":310000,"errmsg":"keywords not in content"}', { status: 200 }),
    );
    await expect(
      sendDingtalk("https://oapi.dingtalk.com/robot/send?access_token=x", {
        eventType: "x",
        payload: {},
      }),
    ).rejects.toBeInstanceOf(NotificationDeliveryError);
  });

  it("throws on 4xx HTTP status", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    await expect(
      sendDingtalk("https://oapi.dingtalk.com/robot/send?access_token=x", {
        eventType: "x",
        payload: {},
      }),
    ).rejects.toBeInstanceOf(NotificationDeliveryError);
  });
});
