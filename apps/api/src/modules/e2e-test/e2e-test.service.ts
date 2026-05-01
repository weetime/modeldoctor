import type { E2ETestRequest, E2ETestResponse, ProbeName } from "@modeldoctor/contracts";
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PROBES, type ProbeCtx, type ProbeResult } from "../../integrations/probes/index.js";
import type { DecryptedConnection } from "../connection/connection.service.js";
import { RunRepository } from "../run/run.repository.js";

function parseHeaderLines(s: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!s || !s.trim()) return out;
  for (const rawLine of s.split("\n").map((l) => l.trim())) {
    if (!rawLine || !rawLine.includes(":")) continue;
    const idx = rawLine.indexOf(":");
    out[rawLine.slice(0, idx).trim()] = rawLine.slice(idx + 1).trim();
  }
  return out;
}

@Injectable()
export class E2ETestService {
  constructor(private readonly runs: RunRepository) {}

  private async executeProbes(
    conn: DecryptedConnection,
    req: E2ETestRequest,
  ): Promise<Array<ProbeResult & { probe: ProbeName }>> {
    const extraHeaders = parseHeaderLines(conn.customHeaders);

    return Promise.all(
      req.probes.map(async (name: ProbeName) => {
        const ctx: ProbeCtx = {
          apiBaseUrl: conn.baseUrl,
          apiKey: conn.apiKey,
          model: conn.model,
          extraHeaders,
          pathOverride: req.pathOverride?.[name],
        };
        try {
          const r = await PROBES[name](ctx);
          return { probe: name, ...r };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return {
            probe: name,
            pass: false,
            latencyMs: null,
            checks: [{ name: "probe execution", pass: false, info: msg }],
            details: { error: msg },
          };
        }
      }),
    );
  }

  async run(userId: string | undefined, conn: DecryptedConnection, req: E2ETestRequest): Promise<E2ETestResponse> {
    // 1. Create Run row (status: pending)
    const created = await this.runs.create({
      userId: userId ?? null,
      kind: "e2e",
      tool: "e2e",
      scenario: {
        probes: req.probes,
        pathOverride: req.pathOverride ?? {},
        apiBaseUrl: conn.baseUrl,
        model: conn.model,
      },
      mode: "correctness",
      driverKind: "local",
      params: req as unknown as Prisma.InputJsonValue,
    });

    // 2. Mark running
    await this.runs.update(created.id, { status: "running", startedAt: new Date() });

    // 3. Execute probes
    try {
      const results = await this.executeProbes(conn, req);
      const allPassed = results.every((r) => r.pass);

      // 4. Persist final state
      await this.runs.update(created.id, {
        status: allPassed ? "completed" : "failed",
        completedAt: new Date(),
        rawOutput: { results } as unknown as Prisma.InputJsonValue,
        summaryMetrics: {
          total: results.length,
          passed: results.filter((r) => r.pass).length,
          failed: results.filter((r) => !r.pass).length,
        } as unknown as Prisma.InputJsonValue,
      });

      return { runId: created.id, success: allPassed, results };
    } catch (err) {
      await this.runs.update(created.id, {
        status: "failed",
        statusMessage: err instanceof Error ? err.message : String(err),
        completedAt: new Date(),
      });
      throw err;
    }
  }
}
