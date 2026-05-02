import type {
  BuildCommandPlan,
  BuildCommandResult,
  ProgressEvent,
  ToolReport,
} from "../core/interface.js";
import { type VegetaParams, type VegetaReport, vegetaReportSchema } from "./schema.js";

const API_TYPE_TO_PATH: Record<VegetaParams["apiType"], string> = {
  chat: "/v1/chat/completions",
  "chat-vision": "/v1/chat/completions",
  "chat-audio": "/v1/chat/completions",
  embeddings: "/v1/embeddings",
  rerank: "/v1/rerank",
  images: "/v1/images/generations",
};

const API_TYPE_TO_BODY: Record<VegetaParams["apiType"], (model: string) => string> = {
  chat: (m) => JSON.stringify({ model: m, messages: [{ role: "user", content: "hello" }] }),
  "chat-vision": (m) =>
    JSON.stringify({ model: m, messages: [{ role: "user", content: "hello" }] }),
  "chat-audio": (m) => JSON.stringify({ model: m, messages: [{ role: "user", content: "hello" }] }),
  embeddings: (m) => JSON.stringify({ model: m, input: "hello" }),
  rerank: (m) => JSON.stringify({ model: m, query: "what is 2+2", documents: ["four", "five"] }),
  images: (m) => JSON.stringify({ model: m, prompt: "a cat" }),
};

export function buildCommand(plan: BuildCommandPlan<VegetaParams>): BuildCommandResult {
  const { params, connection } = plan;
  const path = API_TYPE_TO_PATH[params.apiType];
  let url = connection.baseUrl + path;

  // Append queryParams (one "k=v" per non-empty line)
  if (connection.queryParams.trim()) {
    const ps = connection.queryParams
      .split("\n")
      .map((p) => p.trim())
      .filter((p) => p.length > 0 && p.includes("="));
    if (ps.length > 0) {
      url = url + (url.includes("?") ? "&" : "?") + ps.join("&");
    }
  }

  // customHeaders: one "K: V" per non-empty line
  let extraHeaders = "";
  if (connection.customHeaders.trim()) {
    const lines = connection.customHeaders
      .split("\n")
      .map((h) => h.trim())
      .filter((h) => h.length > 0 && h.includes(":"));
    extraHeaders = lines.map((h) => `\n${h}`).join("");
  }

  const body = API_TYPE_TO_BODY[params.apiType](connection.model);
  // vegeta's HTTP-format target file: "METHOD URL\nHeaders\n@bodyfile"
  const targetsTxt = `POST ${url}\nContent-Type: application/json\nAuthorization: Bearer ${connection.apiKey}${extraHeaders}\n@request.json`;

  const cmd = `cat targets.txt | vegeta attack -rate=${params.rate} -duration=${params.duration}s | tee attack.bin | vegeta report > report.txt`;

  return {
    argv: ["/bin/sh", "-c", cmd],
    env: {},
    secretEnv: {},
    inputFiles: {
      "targets.txt": targetsTxt,
      "request.json": body,
    },
    outputFiles: {
      report: "report.txt",
      attack: "attack.bin",
    },
  };
}

// vegeta CLI is silent during attack; no progress to parse.
export function parseProgress(_line: string): ProgressEvent | null {
  return null;
}

export function parseFinalReport(_stdout: string, files: Record<string, Buffer>): ToolReport {
  const reportBuf = files.report;
  if (!reportBuf) {
    throw new Error("vegeta.parseFinalReport: missing 'report' output file");
  }
  const data = parseVegetaReportText(reportBuf.toString("utf8"));
  vegetaReportSchema.parse(data);
  return { tool: "vegeta", data };
}

// ── internal: ported from apps/api/src/integrations/parsers/vegeta-report.ts ──

// Walks a Go time.Duration string (e.g. "1h2m3.5s", "500µs", "1m30s")
// and returns the total in milliseconds.  Returns NaN for empty or malformed input.
const GO_DURATION_SEGMENT = /([0-9.]+)\s*(µs|ms|s|m|h)/g;
const UNIT_TO_MS: Record<string, number> = {
  µs: 0.001,
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
};

function parseGoDurationToMs(s: string): number {
  let totalMs = 0;
  let lastEnd = 0;
  let matched = false;
  for (const seg of s.matchAll(GO_DURATION_SEGMENT)) {
    // Reject any non-whitespace gap before this segment (malformed input).
    if (s.slice(lastEnd, seg.index).trim() !== "") return Number.NaN;
    totalMs += Number.parseFloat(seg[1]) * (UNIT_TO_MS[seg[2]] ?? Number.NaN);
    lastEnd = seg.index + seg[0].length;
    matched = true;
  }
  // Reject trailing non-whitespace garbage.
  if (s.slice(lastEnd).trim() !== "") return Number.NaN;
  return matched ? totalMs : Number.NaN;
}

function parseLatencyToMs(s: string): number {
  return parseGoDurationToMs(s.trim());
}

function parseDurationToSeconds(s: string): number {
  return parseGoDurationToMs(s.trim()) / 1000;
}

function parseVegetaReportText(report: string): VegetaReport {
  const out: VegetaReport = {
    requests: { total: 0, rate: 0, throughput: 0 },
    duration: { totalSeconds: 0, attackSeconds: 0, waitSeconds: 0 },
    latencies: { min: 0, mean: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0 },
    bytesIn: { total: 0, mean: 0 },
    bytesOut: { total: 0, mean: 0 },
    success: 0,
    statusCodes: {},
    errors: [],
  };

  for (const line of report.split("\n")) {
    if (line.includes("Requests") && line.includes("[total")) {
      const m = line.match(/\]\s+([\d.]+),\s+([\d.]+),\s+([\d.]+)/);
      if (m) {
        out.requests.total = Number.parseInt(m[1], 10);
        out.requests.rate = Number.parseFloat(m[2]);
        out.requests.throughput = Number.parseFloat(m[3]);
      }
    } else if (line.includes("Duration") && line.includes("[total")) {
      const m = line.match(
        /\]\s+((?:[\d.]+(?:µs|ms|s|m|h))+),\s+((?:[\d.]+(?:µs|ms|s|m|h))+),\s+((?:[\d.]+(?:µs|ms|s|m|h))+)/,
      );
      if (m) {
        out.duration.totalSeconds = parseDurationToSeconds(m[1]);
        out.duration.attackSeconds = parseDurationToSeconds(m[2]);
        out.duration.waitSeconds = parseDurationToSeconds(m[3]);
      }
    } else if (line.includes("Latencies") && line.includes("[min")) {
      const m = line.match(
        /\]\s+((?:[\d.]+(?:µs|ms|s|m|h))+),\s+((?:[\d.]+(?:µs|ms|s|m|h))+),\s+((?:[\d.]+(?:µs|ms|s|m|h))+),\s+((?:[\d.]+(?:µs|ms|s|m|h))+),\s+((?:[\d.]+(?:µs|ms|s|m|h))+),\s+((?:[\d.]+(?:µs|ms|s|m|h))+),\s+((?:[\d.]+(?:µs|ms|s|m|h))+)/,
      );
      if (m) {
        out.latencies.min = parseLatencyToMs(m[1]);
        out.latencies.mean = parseLatencyToMs(m[2]);
        out.latencies.p50 = parseLatencyToMs(m[3]);
        out.latencies.p90 = parseLatencyToMs(m[4]);
        out.latencies.p95 = parseLatencyToMs(m[5]);
        out.latencies.p99 = parseLatencyToMs(m[6]);
        out.latencies.max = parseLatencyToMs(m[7]);
      }
    } else if (line.includes("Bytes In") && line.includes("[total")) {
      const m = line.match(/\]\s+([\d.]+),\s+([\d.]+)/);
      if (m) {
        out.bytesIn.total = Number.parseInt(m[1], 10);
        out.bytesIn.mean = Number.parseFloat(m[2]);
      }
    } else if (line.includes("Bytes Out") && line.includes("[total")) {
      const m = line.match(/\]\s+([\d.]+),\s+([\d.]+)/);
      if (m) {
        out.bytesOut.total = Number.parseInt(m[1], 10);
        out.bytesOut.mean = Number.parseFloat(m[2]);
      }
    } else if (line.includes("Success") && line.includes("[ratio]")) {
      const m = line.match(/\]\s+([\d.]+)%/);
      if (m) out.success = Number.parseFloat(m[1]);
    } else if (line.includes("Status Codes") && line.includes("[code:count]")) {
      const m = line.match(/\[code:count\]\s+(.*)/);
      if (m) {
        for (const tok of m[1].trim().split(/\s+/)) {
          const [code, count] = tok.split(":");
          if (code && count) out.statusCodes[code] = Number.parseInt(count, 10);
        }
      }
    } else if (/^\d/.test(line.trim())) {
      // looks like a "500 ..." error line (follows "Error Set:" header)
      out.errors.push(line.trim());
    }
  }

  return out;
}

export function getMaxDurationSeconds(params: VegetaParams): number {
  return params.duration;
}
