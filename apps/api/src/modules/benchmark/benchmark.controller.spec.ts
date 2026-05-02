import type { Run } from "@modeldoctor/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { RunService } from "../run/run.service.js";
import { BenchmarkController } from "./benchmark.controller.js";

const fakeUser: JwtPayload = { sub: "u1", email: "u1@example.com", roles: [] };

function makeRun(over: Partial<Run> = {}): Run {
  return {
    id: "r1",
    userId: "u1",
    connectionId: "conn-1",
    connection: { id: "conn-1", name: "conn" },
    kind: "benchmark",
    tool: "guidellm",
    scenario: { apiBaseUrl: "https://upstream/", model: "m" },
    mode: "fixed",
    driverKind: "local",
    name: "n",
    description: null,
    status: "submitted",
    statusMessage: null,
    progress: null,
    driverHandle: "subprocess:1",
    params: {
      profile: "throughput",
      apiType: "chat",
      datasetName: "random",
      datasetInputTokens: 1024,
      datasetOutputTokens: 128,
      requestRate: 0,
      totalRequests: 1000,
    },
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
    startedAt: null,
    completedAt: null,
    ...over,
  };
}

describe("BenchmarkController (facade)", () => {
  let runs: {
    create: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    findByIdOrFail: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let controller: BenchmarkController;

  beforeEach(() => {
    runs = {
      create: vi.fn(),
      list: vi.fn(),
      findByIdOrFail: vi.fn(),
      cancel: vi.fn(),
      delete: vi.fn(),
    };
    controller = new BenchmarkController(runs as unknown as RunService);
  });

  it("create: translates legacy body to CreateRunRequest and maps the result back", async () => {
    runs.create.mockResolvedValue(makeRun());
    const body = {
      connectionId: "conn-1",
      name: "n",
      profile: "throughput" as const,
      apiType: "chat" as const,
      datasetName: "random" as const,
      datasetInputTokens: 1024,
      datasetOutputTokens: 128,
      requestRate: 0,
      totalRequests: 1000,
    };

    const out = await controller.create(fakeUser, body);

    expect(runs.create).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        tool: "guidellm",
        kind: "benchmark",
        connectionId: "conn-1",
        name: "n",
        params: expect.objectContaining({
          profile: "throughput",
          apiType: "chat",
          datasetName: "random",
          datasetInputTokens: 1024,
          datasetOutputTokens: 128,
          requestRate: 0,
          totalRequests: 1000,
        }),
      }),
    );
    expect(out.id).toBe("r1");
    expect(out.profile).toBe("throughput");
    expect(out.apiType).toBe("chat");
    expect(out.apiBaseUrl).toBe("https://upstream/");
    expect(out.model).toBe("m");
    expect(out.state).toBe("submitted");
  });

  it("list: translates legacy query to RunService.list query", async () => {
    runs.list.mockResolvedValue({ items: [makeRun()], nextCursor: null });

    const out = await controller.list(fakeUser, {
      limit: 10,
      state: "running",
      search: "abc",
    });

    expect(runs.list).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 10,
        kind: "benchmark",
        tool: "guidellm",
        status: "running",
        search: "abc",
      }),
      "u1",
    );
    expect(out.items).toHaveLength(1);
    expect(out.items[0].id).toBe("r1");
    expect(out.items[0].state).toBe("submitted");
  });

  it("list: applies in-memory profile filter", async () => {
    const a = makeRun({ id: "a", params: { profile: "throughput" } });
    const b = makeRun({ id: "b", params: { profile: "latency" } });
    runs.list.mockResolvedValue({ items: [a, b], nextCursor: "next" });

    const out = await controller.list(fakeUser, {
      limit: 10,
      profile: "latency",
    });

    expect(out.items.map((s) => s.id)).toEqual(["b"]);
    expect(out.nextCursor).toBe("next");
  });

  it("detail: forwards id + userId to findByIdOrFail and maps result", async () => {
    runs.findByIdOrFail.mockResolvedValue(makeRun({ id: "rX" }));

    const out = await controller.detail(fakeUser, "rX");

    expect(runs.findByIdOrFail).toHaveBeenCalledWith("rX", "u1");
    expect(out.id).toBe("rX");
  });

  it("cancel: forwards to RunService.cancel and maps result", async () => {
    runs.cancel.mockResolvedValue(makeRun({ id: "rX", status: "canceled" }));

    const out = await controller.cancel(fakeUser, "rX");

    expect(runs.cancel).toHaveBeenCalledWith("rX", "u1");
    expect(out.state).toBe("canceled");
  });

  it("delete: forwards to RunService.delete and resolves void", async () => {
    runs.delete.mockResolvedValue(undefined);

    const out = await controller.delete(fakeUser, "rX");

    expect(runs.delete).toHaveBeenCalledWith("rX", "u1");
    expect(out).toBeUndefined();
  });
});
