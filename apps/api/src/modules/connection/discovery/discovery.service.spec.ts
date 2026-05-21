import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DiscoveryService } from "./discovery.service.js";

vi.mock("./ssrf-guard.js", () => ({
  assertSafeUrl: vi.fn(),
}));
vi.mock("./probes/models.js", () => ({ runModelsProbe: vi.fn() }));
vi.mock("./probes/metrics.js", () => ({ runMetricsProbe: vi.fn() }));
vi.mock("./probes/health.js", () => ({ runHealthProbe: vi.fn() }));
vi.mock("./probes/server-header.js", () => ({ runServerHeaderProbe: vi.fn() }));

import { runHealthProbe } from "./probes/health.js";
import { runMetricsProbe } from "./probes/metrics.js";
import { runModelsProbe } from "./probes/models.js";
import { runServerHeaderProbe } from "./probes/server-header.js";
import { assertSafeUrl } from "./ssrf-guard.js";

describe("DiscoveryService", () => {
  let service: DiscoveryService;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(assertSafeUrl).mockResolvedValue({
      safeUrl: new URL("http://x"),
      resolvedIp: "10.0.0.1",
    });
    const module = await Test.createTestingModule({ providers: [DiscoveryService] }).compile();
    service = module.get(DiscoveryService);
  });

  it("aggregates 4 probe results into B+ shape (happy path: vLLM)", async () => {
    vi.mocked(runModelsProbe).mockResolvedValue({
      ok: true,
      durationMs: 100,
      data: { models: ["llama-3-70b-instruct"], raw: { data: [{ id: "llama-3-70b-instruct" }] } },
    });
    vi.mocked(runMetricsProbe).mockResolvedValue({
      ok: true,
      durationMs: 80,
      data: { body: "vllm:request_success_total 42\n" },
    });
    vi.mocked(runHealthProbe).mockResolvedValue({
      ok: true,
      durationMs: 30,
      data: { path: "/health" },
    });
    vi.mocked(runServerHeaderProbe).mockResolvedValue({
      ok: true,
      durationMs: 25,
      data: { server: "vllm/0.6.4", poweredBy: null },
    });

    const r = await service.discover({ baseUrl: "http://x" });

    expect(r.health.probesAttempted).toBe(4);
    expect(r.health.probesFailed).toEqual([]);
    expect(r.inferred.serverKind.value).toBe("vllm");
    expect(r.inferred.serverKind.confidence).toBe("certain");
    expect(r.inferred.models.values).toEqual(["llama-3-70b-instruct"]);
    expect(r.inferred.category.value).toBe("chat");
    expect(r.inferred.suggestedTags.values).toContain("vllm");
    expect(r.inferred.suggestedTags.values).toContain("70b");
  });

  it("records probe failures in health.probesFailed", async () => {
    vi.mocked(runModelsProbe).mockResolvedValue({
      ok: false,
      durationMs: 50,
      reason: "HTTP 401",
    });
    vi.mocked(runMetricsProbe).mockResolvedValue({
      ok: false,
      durationMs: 50,
      reason: "HTTP 404",
    });
    vi.mocked(runHealthProbe).mockResolvedValue({
      ok: true,
      durationMs: 20,
      data: { path: "/health" },
    });
    vi.mocked(runServerHeaderProbe).mockResolvedValue({
      ok: true,
      durationMs: 25,
      data: { server: null, poweredBy: null },
    });

    const r = await service.discover({ baseUrl: "http://x" });

    expect(r.health.probesFailed).toHaveLength(2);
    expect(r.health.probesFailed.map((p) => p.probe).sort()).toEqual(["metrics", "models"]);
    expect(r.inferred.serverKind.value).toBeNull();
    expect(r.inferred.serverKind.confidence).toBe("unknown");
  });

  it("propagates SSRF reject as BadRequestException", async () => {
    vi.mocked(assertSafeUrl).mockRejectedValueOnce(new Error("Cloud metadata endpoint blocked"));
    await expect(service.discover({ baseUrl: "http://169.254.169.254" })).rejects.toThrow(
      /Cloud metadata/,
    );
  });

  it("forwards parsed customHeaders to every probe (Higress routing)", async () => {
    vi.mocked(runModelsProbe).mockResolvedValue({
      ok: true,
      durationMs: 50,
      data: { models: ["qwen-72b"], raw: { data: [{ id: "qwen-72b" }] } },
    });
    vi.mocked(runMetricsProbe).mockResolvedValue({ ok: false, durationMs: 50, reason: "HTTP 404" });
    vi.mocked(runHealthProbe).mockResolvedValue({
      ok: true,
      durationMs: 20,
      data: { path: "/health" },
    });
    vi.mocked(runServerHeaderProbe).mockResolvedValue({
      ok: true,
      durationMs: 25,
      data: { server: null, poweredBy: null },
    });

    await service.discover({
      baseUrl: "http://gateway:8000",
      apiKey: "sk-test",
      customHeaders: "x-higress-llm-model: qwen-72b\n# comment line\nX-Project-Id: p_123",
    });

    const expectedCtx = expect.objectContaining({
      baseUrl: "http://gateway:8000",
      apiKey: "sk-test",
      extraHeaders: { "x-higress-llm-model": "qwen-72b", "X-Project-Id": "p_123" },
    });
    expect(runModelsProbe).toHaveBeenCalledWith(expectedCtx);
    expect(runMetricsProbe).toHaveBeenCalledWith(expectedCtx);
    expect(runHealthProbe).toHaveBeenCalledWith(expectedCtx);
    expect(runServerHeaderProbe).toHaveBeenCalledWith(expectedCtx);
  });

  it("omits extraHeaders when customHeaders is empty / blank-only", async () => {
    vi.mocked(runModelsProbe).mockResolvedValue({
      ok: true,
      durationMs: 50,
      data: { models: [], raw: { data: [] } },
    });
    vi.mocked(runMetricsProbe).mockResolvedValue({ ok: false, durationMs: 50, reason: "HTTP 404" });
    vi.mocked(runHealthProbe).mockResolvedValue({
      ok: true,
      durationMs: 20,
      data: { path: "/health" },
    });
    vi.mocked(runServerHeaderProbe).mockResolvedValue({
      ok: true,
      durationMs: 25,
      data: { server: null, poweredBy: null },
    });

    await service.discover({
      baseUrl: "http://x",
      customHeaders: "\n  \n# only comments\n",
    });

    expect(runModelsProbe).toHaveBeenCalledWith(
      expect.objectContaining({ extraHeaders: undefined }),
    );
  });

  it("emits warning when /v1/models is 401 but /health is OK", async () => {
    vi.mocked(runModelsProbe).mockResolvedValue({
      ok: false,
      durationMs: 50,
      reason: "HTTP 401",
    });
    vi.mocked(runMetricsProbe).mockResolvedValue({ ok: false, durationMs: 50, reason: "HTTP 404" });
    vi.mocked(runHealthProbe).mockResolvedValue({
      ok: true,
      durationMs: 20,
      data: { path: "/health" },
    });
    vi.mocked(runServerHeaderProbe).mockResolvedValue({
      ok: true,
      durationMs: 25,
      data: { server: null, poweredBy: null },
    });

    const r = await service.discover({ baseUrl: "http://x", apiKey: "wrong-key" });
    expect(r.health.warnings.some((w) => w.includes("apiKey"))).toBe(true);
  });
});
