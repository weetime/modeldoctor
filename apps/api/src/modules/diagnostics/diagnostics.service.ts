import type {
  DiagnosticsRunRequest,
  DiagnosticsRunResponse,
  ProbeName,
  ProbeResult,
} from "@modeldoctor/contracts";
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PROBES, type ProbeCtx } from "../../integrations/probes/index.js";
import type { DecryptedConnection } from "../connection/connection.service.js";
import { DiagnosticsRepository } from "./diagnostics.repository.js";

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
export class DiagnosticsService {
  constructor(private readonly repo: DiagnosticsRepository) {}

  private async executeProbes(
    conn: DecryptedConnection,
    req: DiagnosticsRunRequest,
  ): Promise<ProbeResult[]> {
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

  async run(
    userId: string | undefined,
    conn: DecryptedConnection,
    req: DiagnosticsRunRequest,
  ): Promise<DiagnosticsRunResponse> {
    const created = await this.repo.create({
      userId: userId ?? null,
      connectionId: conn.id,
      probes: req.probes,
      pathOverride: (req.pathOverride ?? {}) as Prisma.InputJsonValue,
    });

    try {
      const results = await this.executeProbes(conn, req);
      const allPassed = results.every((r) => r.pass);
      await this.repo.update(created.id, {
        status: allPassed ? "completed" : "failed",
        completedAt: new Date(),
        results: results as unknown as Prisma.InputJsonValue,
        summary: {
          total: results.length,
          passed: results.filter((r) => r.pass).length,
          failed: results.filter((r) => !r.pass).length,
        } as Prisma.InputJsonValue,
      });
      return { diagnosticsRunId: created.id, success: allPassed, results };
    } catch (err) {
      await this.repo.update(created.id, {
        status: "failed",
        statusMessage: err instanceof Error ? err.message : String(err),
        completedAt: new Date(),
      });
      throw err;
    }
  }
}
