import { Injectable } from "@nestjs/common";
import type {
  E2ETestRequest,
  E2ETestResponse,
} from "@modeldoctor/contracts";
import {
  PROBES,
  type ProbeCtx,
  type ProbeName,
} from "../../integrations/probes/index.js";

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
    const ctx: ProbeCtx = {
      apiUrl: req.apiUrl,
      apiKey: req.apiKey,
      model: req.model,
      extraHeaders,
    };

    const results = await Promise.all(
      req.probes.map(async (name: ProbeName) => {
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
