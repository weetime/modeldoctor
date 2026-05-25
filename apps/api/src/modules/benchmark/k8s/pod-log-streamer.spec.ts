import { Logger } from "@nestjs/common";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { PodLogStreamer } from "./pod-log-streamer.js";

function makeK8sLogMock(streams: PassThrough[]) {
  let i = 0;
  return {
    log: vi.fn(async (_ns, _pod, _container, sink) => {
      const passthrough = streams[i++];
      if (!passthrough) throw new Error(`k8sLog.log called too many times (i=${i})`);
      // Pipe our test passthrough → caller's sink so 'end'/'error' propagate
      passthrough.pipe(sink as PassThrough);
      return { abort: vi.fn() };
    }),
  };
}

const fakeLog = new Logger("test");

describe("PodLogStreamer", () => {
  it("emits handleLine per line, resolves on clean EOF", async () => {
    const stream = new PassThrough();
    const k8s = makeK8sLogMock([stream]);
    const lines: string[] = [];
    const streamer = new PodLogStreamer(
      "r1", "pod-r1", "runner", "ns",
      k8s as never, (l) => lines.push(l), fakeLog,
    );
    const done = streamer.run();
    stream.write("alpha\n");
    stream.write("beta\ngamma\n");
    stream.end();
    await done;
    expect(lines).toEqual(["alpha", "beta", "gamma"]);
    expect(k8s.log).toHaveBeenCalledTimes(1);
  });

  it("reconnects with sinceSeconds=10 after one error", async () => {
    const s1 = new PassThrough();
    const s2 = new PassThrough();
    const k8s = makeK8sLogMock([s1, s2]);
    const lines: string[] = [];
    const streamer = new PodLogStreamer(
      "r1", "pod-r1", "runner", "ns",
      k8s as never, (l) => lines.push(l), fakeLog,
    );
    const done = streamer.run();
    s1.write("first\n");
    s1.destroy(new Error("connection reset"));
    // wait for reconnect backoff (1s) + flow continues
    await new Promise((r) => setTimeout(r, 1100));
    s2.write("after-reconnect\n");
    s2.end();
    await done;
    expect(lines).toContain("first");
    expect(lines).toContain("after-reconnect");
    expect(k8s.log).toHaveBeenCalledTimes(2);
    expect(k8s.log.mock.calls[1][4]).toEqual({ follow: true, sinceSeconds: 10 });
  }, 10_000);

  it("gives up after 3 consecutive failures", async () => {
    const streams = [new PassThrough(), new PassThrough(), new PassThrough()];
    const k8s = makeK8sLogMock(streams);
    const streamer = new PodLogStreamer(
      "r1", "pod-r1", "runner", "ns",
      k8s as never, () => {}, fakeLog,
    );
    const done = streamer.run();
    for (const s of streams) s.destroy(new Error("boom"));
    // backoff: 1s + 2s = 3s minimum between attempts
    await done;
    expect(k8s.log).toHaveBeenCalledTimes(3);
  }, 15_000);

  it("abort() stops the loop and prevents further reconnects", async () => {
    const s1 = new PassThrough();
    const k8s = makeK8sLogMock([s1]);
    const streamer = new PodLogStreamer(
      "r1", "pod-r1", "runner", "ns",
      k8s as never, () => {}, fakeLog,
    );
    const done = streamer.run();
    s1.write("x\n");
    streamer.abort();
    s1.destroy(new Error("after abort"));  // should not trigger reconnect
    await done;
    expect(k8s.log).toHaveBeenCalledTimes(1);
  });

  it("drainOrTimeout(0) aborts immediately", async () => {
    const s1 = new PassThrough();
    const k8s = makeK8sLogMock([s1]);
    const streamer = new PodLogStreamer(
      "r1", "pod-r1", "runner", "ns",
      k8s as never, () => {}, fakeLog,
    );
    void streamer.run();
    await streamer.drainOrTimeout(0);
    // run() resolves once state=STOPPED
  });

  it("drainOrTimeout(timeoutMs) waits for natural EOF or aborts", async () => {
    const s1 = new PassThrough();
    const k8s = makeK8sLogMock([s1]);
    const streamer = new PodLogStreamer(
      "r1", "pod-r1", "runner", "ns",
      k8s as never, () => {}, fakeLog,
    );
    void streamer.run();
    // No EOF — should timeout
    const t0 = Date.now();
    await streamer.drainOrTimeout(200);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(190);
  });

  it("handleLine throw does not crash the loop", async () => {
    const stream = new PassThrough();
    const k8s = makeK8sLogMock([stream]);
    let count = 0;
    const streamer = new PodLogStreamer(
      "r1", "pod-r1", "runner", "ns",
      k8s as never,
      () => { count++; throw new Error("oops"); },
      fakeLog,
    );
    const done = streamer.run();
    stream.write("a\nb\n");
    stream.end();
    await done;
    expect(count).toBe(2);
  });
});
