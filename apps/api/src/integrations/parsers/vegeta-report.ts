/**
 * Parses Vegeta CLI's stdout (text table) into a structured object.
 *
 * Ported verbatim from the legacy CJS parser (src/parsers/vegeta-report.js).
 * Behaviour is preserved exactly:
 *   - `success` is a percentage number in [0, 100] (e.g. 100 for "100.00%"),
 *     NOT a 0-1 ratio.
 *   - Latency values keep their unit suffix (e.g. "45.6ms").
 *   - `requests`, `bytesIn`, `bytesOut` are parsed with parseInt (integers).
 *   - Missing / malformed fields stay null or empty object.
 *
 * The structural subset {requests, success, throughput, latencies.{mean,p50,p95,p99,max}}
 * matches the FE's `LoadTestParsed` type at apps/web/src/features/load-test/types.ts.
 */

export interface VegetaLatencies {
  min: string | null;
  mean: string | null;
  p50: string | null;
  p90: string | null;
  p95: string | null;
  p99: string | null;
  max: string | null;
}

export interface VegetaParsed {
  requests: number | null;
  rate: number | null;
  throughput: number | null;
  duration: string | null;
  latencies: VegetaLatencies;
  bytesIn: number | null;
  bytesOut: number | null;
  /** Success ratio as a percent in [0, 100] (matches legacy: "100.00%" -> 100). */
  success: number | null;
  statusCodes: Record<string, number>;
}

function emptyLatencies(): VegetaLatencies {
  return {
    min: null,
    mean: null,
    p50: null,
    p90: null,
    p95: null,
    p99: null,
    max: null,
  };
}

export function parseVegetaReport(report: string): VegetaParsed {
  const parsed: VegetaParsed = {
    requests: null,
    rate: null,
    throughput: null,
    duration: null,
    latencies: emptyLatencies(),
    bytesIn: null,
    bytesOut: null,
    success: null,
    statusCodes: {},
  };

  const lines = report.split("\n");

  for (const line of lines) {
    if (line.includes("Requests") && line.includes("[total")) {
      const match = line.match(/Requests\s+\[.*?\]\s+([\d.]+)/);
      if (match && match[1] !== undefined) parsed.requests = Number.parseInt(match[1]);

      const valuesMatch = line.match(/\]\s+([\d.]+),\s+([\d.]+),\s+([\d.]+)/);
      if (
        valuesMatch &&
        valuesMatch[1] !== undefined &&
        valuesMatch[2] !== undefined &&
        valuesMatch[3] !== undefined
      ) {
        parsed.requests = Number.parseInt(valuesMatch[1]);
        parsed.rate = Number.parseFloat(valuesMatch[2]);
        parsed.throughput = Number.parseFloat(valuesMatch[3]);
      }
    }

    if (line.includes("Duration") && line.includes("[total")) {
      const match = line.match(/\]\s+([\d.]+[a-z]+)/);
      if (match && match[1] !== undefined) parsed.duration = match[1];
    }

    if (line.includes("Latencies") && line.includes("[min")) {
      const valuesMatch = line.match(
        /\]\s+([\d.]+[a-z]+),\s+([\d.]+[a-z]+),\s+([\d.]+[a-z]+),\s+([\d.]+[a-z]+),\s+([\d.]+[a-z]+),\s+([\d.]+[a-z]+),\s+([\d.]+[a-z]+)/,
      );
      if (valuesMatch) {
        parsed.latencies.min = valuesMatch[1] ?? null;
        parsed.latencies.mean = valuesMatch[2] ?? null;
        parsed.latencies.p50 = valuesMatch[3] ?? null;
        parsed.latencies.p90 = valuesMatch[4] ?? null;
        parsed.latencies.p95 = valuesMatch[5] ?? null;
        parsed.latencies.p99 = valuesMatch[6] ?? null;
        parsed.latencies.max = valuesMatch[7] ?? null;
      }
    }

    if (line.includes("Bytes In") && line.includes("[total")) {
      const match = line.match(/\]\s+([\d.]+)/);
      if (match && match[1] !== undefined) parsed.bytesIn = Number.parseInt(match[1]);
    }

    if (line.includes("Bytes Out") && line.includes("[total")) {
      const match = line.match(/\]\s+([\d.]+)/);
      if (match && match[1] !== undefined) parsed.bytesOut = Number.parseInt(match[1]);
    }

    if (line.includes("Success") && line.includes("[ratio]")) {
      const match = line.match(/\]\s+([\d.]+)%/);
      if (match && match[1] !== undefined) parsed.success = Number.parseFloat(match[1]);
    }

    if (line.includes("Status Codes") && line.includes("[code:count]")) {
      const match = line.match(/\[code:count\]\s+(.*)/);
      if (match && match[1] !== undefined) {
        const codes = match[1].trim().split(/\s+/);
        for (const code of codes) {
          const [status, count] = code.split(":");
          if (status && count) {
            parsed.statusCodes[status] = Number.parseInt(count);
          }
        }
      }
    }
  }

  return parsed;
}
