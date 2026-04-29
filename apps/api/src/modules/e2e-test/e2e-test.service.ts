import type { E2ETestRequest, E2ETestResponse, ProbeName } from "@modeldoctor/contracts";
import { Injectable } from "@nestjs/common";
import { PROBES, type ProbeCtx } from "../../integrations/probes/index.js";

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
  async run(req: E2ETestRequest): Promise<E2ETestResponse> {
    const extraHeaders = parseHeaderLines(req.customHeaders);

    const results = await Promise.all(
      req.probes.map(async (name: ProbeName) => {
        const ctx: ProbeCtx = {
          apiBaseUrl: req.apiBaseUrl,
          apiKey: req.apiKey,
          model: req.model,
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

    return { success: true, results };
  }
}
