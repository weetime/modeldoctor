import type { Run } from "@modeldoctor/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { RunService } from "../run/run.service.js";
import { LoadTestController } from "./load-test.controller.js";

const fakeUser: JwtPayload = { sub: "u1", email: "u1@example.com", roles: [] };

function makeRun(over: Partial<Run> = {}): Run {
  return {
    id: "r1",
    userId: "u1",
    connectionId: "conn-1",
    connection: { id: "conn-1", name: "conn" },
    kind: "benchmark",
    tool: "vegeta",
    scenario: { apiBaseUrl: "https://upstream/", model: "m" },
    mode: "fixed",
    driverKind: "local",
    name: "loadtest-x",
    description: null,
    status: "completed",
    statusMessage: null,
    progress: null,
    driverHandle: "subprocess:1",
    params: { apiType: "chat", rate: 10, duration: 5 },
    rawOutput: null,
    summaryMetrics: null,
    serverMetrics: null,
    templateId: null,
    templateVersion: null,
    parentRunId: null,
    baselineId: null,
    baselineFor: null,
    logs: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    startedAt: "2024-01-01T00:00:01.000Z",
    completedAt: "2024-01-01T00:00:06.000Z",
    ...over,
  };
}

describe("LoadTestController (facade)", () => {
  let runs: {
    create: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
  };
  let controller: LoadTestController;

  beforeEach(() => {
    runs = {
      create: vi.fn(),
      list: vi.fn(),
      findById: vi.fn(),
    };
    controller = new LoadTestController(runs as unknown as RunService);
  });

  describe("POST /load-test", () => {
    it("translates body to CreateRunRequest, polls until terminal, and maps response", async () => {
      const submitted = makeRun({ status: "submitted" });
      const finished = makeRun({
        status: "completed",
        rawOutput: {
          stdout: "",
          stderr: "",
          files: { report: Buffer.from("report-text", "utf8").toString("base64") },
        },
      });
      runs.create.mockResolvedValue(submitted);
      // Return terminal on the very first poll → loop exits before any setTimeout.
      runs.findById.mockResolvedValue(finished);

      const out = await controller.run(
        { connectionId: "conn-1", apiType: "chat", rate: 10, duration: 5 },
        fakeUser,
      );

      expect(runs.create).toHaveBeenCalledWith(
        "u1",
        expect.objectContaining({
          tool: "vegeta",
          kind: "benchmark",
          connectionId: "conn-1",
          name: expect.stringMatching(/^loadtest-/),
          params: expect.objectContaining({ apiType: "chat", rate: 10, duration: 5 }),
        }),
      );
      expect(runs.findById).toHaveBeenCalledWith("r1");
      expect(out.success).toBe(true);
      expect(out.runId).toBe("r1");
      expect(out.report).toBe("report-text");
    });

    it("treats 'failed' as terminal (does not throw the timeout error)", async () => {
      runs.create.mockResolvedValue(makeRun({ status: "submitted" }));
      runs.findById.mockResolvedValue(makeRun({ status: "failed" }));

      const out = await controller.run({ connectionId: "conn-1", rate: 1, duration: 1 }, fakeUser);

      expect(out.runId).toBe("r1");
      // No summary written → all parsed fields null.
      expect(out.parsed.requests).toBeNull();
    });

    it("treats 'canceled' as terminal", async () => {
      runs.create.mockResolvedValue(makeRun({ status: "submitted" }));
      runs.findById.mockResolvedValue(makeRun({ status: "canceled" }));

      const out = await controller.run({ connectionId: "conn-1", rate: 1, duration: 1 }, fakeUser);
      expect(out.runId).toBe("r1");
    });

    it("throws a timeout error when the run never reaches terminal state", async () => {
      // Use fake timers so the 500ms polling sleep doesn't actually wall-block.
      vi.useFakeTimers();
      try {
        runs.create.mockResolvedValue(makeRun({ status: "submitted" }));
        runs.findById.mockResolvedValue(makeRun({ status: "running" }));

        // Override Date.now to push past the deadline immediately. Easier
        // than spinning the polling loop with advanceTimersByTime — we just
        // want to assert the error path triggers.
        const realDateNow = Date.now;
        let calls = 0;
        const stub = vi.spyOn(Date, "now").mockImplementation(() => {
          calls += 1;
          // First call computes deadline = now + timeoutSec*1000.
          // Second call (loop check) jumps far ahead → loop exits with error.
          return calls === 1 ? 0 : 10_000_000;
        });

        await expect(
          controller.run({ connectionId: "conn-1", rate: 1, duration: 1 }, fakeUser),
        ).rejects.toThrow(/did not reach terminal state/);

        stub.mockRestore();
        Date.now = realDateNow;
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("GET /load-test/runs", () => {
    it("returns empty page when RunService.list yields no items", async () => {
      runs.list.mockResolvedValue({ items: [], nextCursor: null });

      const out = await controller.list({ limit: 20 }, fakeUser);

      expect(runs.list).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 20, kind: "benchmark", tool: "vegeta" }),
        "u1",
      );
      expect(out).toEqual({ items: [], nextCursor: null });
    });

    it("maps mixed-state items: completed stays 'completed', non-terminal collapses to 'failed'", async () => {
      const ok = makeRun({ id: "ok", status: "completed" });
      const running = makeRun({ id: "running", status: "running" });
      const canceled = makeRun({ id: "canc", status: "canceled" });
      runs.list.mockResolvedValue({
        items: [ok, running, canceled],
        nextCursor: "next-cursor",
      });

      const out = await controller.list({ limit: 20 }, fakeUser);

      expect(out.items.map((s) => [s.id, s.status])).toEqual([
        ["ok", "completed"],
        ["running", "failed"],
        ["canc", "failed"],
      ]);
      expect(out.nextCursor).toBe("next-cursor");
    });

    it("populates summaryJson by unwrapping the {tool,data} envelope", async () => {
      const completed = makeRun({
        status: "completed",
        summaryMetrics: {
          tool: "vegeta",
          data: {
            requests: { total: 100, rate: 10, throughput: 9.5 },
            duration: { totalSeconds: 10.5, attackSeconds: 10, waitSeconds: 0.5 },
            latencies: { min: 1, mean: 30, p50: 25, p90: 50, p95: 60, p99: 90, max: 150 },
            bytesIn: { total: 1024, mean: 10.24 },
            bytesOut: { total: 2048, mean: 20.48 },
            success: 99,
            statusCodes: { "200": 99, "500": 1 },
            errors: ["one error"],
          },
        },
      });
      runs.list.mockResolvedValue({ items: [completed], nextCursor: null });

      const out = await controller.list({ limit: 20 }, fakeUser);

      expect(out.items[0].summaryJson).not.toBeNull();
      expect(out.items[0].summaryJson?.requests).toBe(100);
      expect(out.items[0].summaryJson?.success).toBe(99);
      expect(out.items[0].summaryJson?.latencies.p95).toBe("60ms");
    });

    it("returns null summaryJson when summaryMetrics is missing or malformed", async () => {
      runs.list.mockResolvedValue({
        items: [makeRun({ summaryMetrics: null }), makeRun({ summaryMetrics: { random: "x" } })],
        nextCursor: null,
      });

      const out = await controller.list({ limit: 20 }, fakeUser);
      expect(out.items[0].summaryJson).toBeNull();
      expect(out.items[1].summaryJson).toBeNull();
    });
  });
});
