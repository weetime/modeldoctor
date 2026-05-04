import type { BenchmarkChartsResponse, HistogramBucket } from "@modeldoctor/contracts";
import { Injectable, Logger } from "@nestjs/common";

const HISTOGRAM_BIN_COUNT = 30;
const TERMINAL_STATES = new Set(["completed", "failed", "canceled"]);

interface ExtractInput {
  id: string;
  tool: string;
  status: string;
  rawOutput: Record<string, unknown> | null;
}

@Injectable()
export class BenchmarkChartsService {
  private readonly log = new Logger(BenchmarkChartsService.name);

  /**
   * Pure derivation: takes a Run row, returns chart data. Errors in any one
   * extraction step degrade that field to null; the other field is unaffected.
   * No DB or HTTP side-effects.
   */
  extract(row: ExtractInput): BenchmarkChartsResponse {
    const empty: BenchmarkChartsResponse = { latencyCdf: null, ttftHistogram: null };

    if (!TERMINAL_STATES.has(row.status)) return empty;
    const files = (row.rawOutput?.files ?? null) as Record<string, string> | null;
    if (!files) return empty;

    if (row.tool === "guidellm") return this.extractGuidellm(row.id, files);
    if (row.tool === "vegeta") return this.extractVegeta(row.id, files);
    return empty;
  }

  private extractGuidellm(runId: string, files: Record<string, string>): BenchmarkChartsResponse {
    const reportB64 = files.report;
    if (!reportB64) return { latencyCdf: null, ttftHistogram: null };

    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(reportB64, "base64").toString("utf8"));
    } catch (e) {
      this.log.warn(`run ${runId}: guidellm report parse failed: ${(e as Error).message}`);
      return { latencyCdf: null, ttftHistogram: null };
    }

    // Verified path (Task 3 Step 3.1 against real run cmophc6pa001f5xerhu3lzvlx):
    //   benchmarks[0].requests.successful[] = {
    //     request_latency: <seconds>,
    //     time_to_first_token_ms: <ms>,
    //     ...
    //   }
    // Note: the `requests` value is an OBJECT { successful, errored,
    // incomplete, total }, NOT an array. We only use successful samples
    // for chart distributions; failed/incomplete have no meaningful latency.
    const root = parsed as Record<string, unknown>;
    const benches = root.benchmarks as Array<Record<string, unknown>> | undefined;
    const first = benches?.[0];
    const requestsBucket = first?.requests as
      | { successful?: Array<Record<string, unknown>> }
      | undefined;
    const successful = requestsBucket?.successful;

    if (!successful || successful.length === 0) {
      return { latencyCdf: null, ttftHistogram: null };
    }

    // request_latency in seconds → ms; time_to_first_token_ms is already ms.
    // Filter out nullish values defensively (a response may omit them).
    const latencyMs = successful
      .map((r) => Number(r.request_latency))
      .filter((n) => Number.isFinite(n) && n >= 0)
      .map((sec) => sec * 1000);

    const ttftMs = successful
      .map((r) => Number(r.time_to_first_token_ms))
      .filter((n) => Number.isFinite(n) && n >= 0);

    return {
      latencyCdf: latencyMs.length > 0 ? { samples: latencyMs } : null,
      ttftHistogram: ttftMs.length > 0 ? { buckets: bucketize(ttftMs, HISTOGRAM_BIN_COUNT) } : null,
    };
  }

  private extractVegeta(runId: string, files: Record<string, string>): BenchmarkChartsResponse {
    const ndjsonB64 = files.latencies;
    if (!ndjsonB64) return { latencyCdf: null, ttftHistogram: null };

    const text = Buffer.from(ndjsonB64, "base64").toString("utf8");
    const samplesMs: number[] = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed) as { latency?: number };
        if (typeof obj.latency === "number" && obj.latency >= 0) {
          samplesMs.push(obj.latency / 1_000_000);
        }
      } catch {
        // Skip individual malformed lines silently — vegeta encode rarely
        // produces partial lines, but if it does we want the rest.
      }
    }

    if (samplesMs.length === 0) {
      this.log.warn(`run ${runId}: vegeta NDJSON yielded zero samples`);
      return { latencyCdf: null, ttftHistogram: null };
    }

    return { latencyCdf: { samples: samplesMs }, ttftHistogram: null };
  }
}

/**
 * Equal-width binning. Returns exactly `binCount` buckets spanning min..max,
 * with last bucket inclusive of the max sample.
 */
function bucketize(samples: number[], binCount: number): HistogramBucket[] {
  if (samples.length === 0) return [];
  let min = samples[0];
  let max = samples[0];
  for (const v of samples) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === max) {
    // All samples equal — one non-empty bucket, rest empty
    return Array.from({ length: binCount }, (_, i) => ({
      lower: min,
      upper: max,
      count: i === 0 ? samples.length : 0,
    }));
  }
  const width = (max - min) / binCount;
  const buckets: HistogramBucket[] = Array.from({ length: binCount }, (_, i) => ({
    lower: min + i * width,
    upper: min + (i + 1) * width,
    count: 0,
  }));
  for (const v of samples) {
    let idx = Math.floor((v - min) / width);
    if (idx >= binCount) idx = binCount - 1; // include max in last bucket
    buckets[idx].count += 1;
  }
  return buckets;
}
