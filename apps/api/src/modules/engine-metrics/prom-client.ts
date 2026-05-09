import { Injectable, Logger } from "@nestjs/common";

export interface PromQueryRangeArgs {
  baseUrl: string;
  query: string;
  from: Date;
  to: Date;
  /** seconds */
  step: number;
  /** abort after N ms (default 8s — Prom should answer in <1s normally) */
  timeoutMs?: number;
}

export interface PromSeries {
  label?: string;
  samples: Array<[number, number]>; // [unixSeconds, value]
}

export type PromUnavailableReason = "no_data" | "prom_error";

export interface PromQueryRangeResult {
  unavailable: boolean;
  reason?: PromUnavailableReason;
  series: PromSeries[];
}

interface PromMatrixSample {
  metric: Record<string, string>;
  values: Array<[number, string]>;
}

interface PromMatrixResponse {
  status: "success" | "error";
  data?: {
    resultType: "matrix" | "vector" | string;
    result: PromMatrixSample[];
  };
  error?: string;
}

const LABEL_PREFERENCE_ORDER = [
  "series", // synthesized by manifest label_replace(..., "series", "<name>", "", ".*") calls
  "pod",
  "instance",
  "finished_reason",
  "quantile",
] as const;

function pickLabel(metric: Record<string, string>): string | undefined {
  for (const k of LABEL_PREFERENCE_ORDER) {
    const v = metric[k];
    if (v !== undefined && v !== "") return v;
  }
  return undefined;
}

@Injectable()
export class PromClient {
  private readonly log = new Logger(PromClient.name);

  async queryRange(args: PromQueryRangeArgs): Promise<PromQueryRangeResult> {
    const start = Math.floor(args.from.getTime() / 1000);
    const end = Math.floor(args.to.getTime() / 1000);
    const url = `${args.baseUrl.replace(/\/$/, "")}/api/v1/query_range?query=${encodeURIComponent(
      args.query,
    )}&start=${start}&end=${end}&step=${args.step}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? 8_000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        this.log.warn(`prom queryRange ${res.status} for query=${args.query.slice(0, 80)}`);
        return { unavailable: true, reason: "prom_error", series: [] };
      }
      const body = (await res.json()) as PromMatrixResponse;
      if (body.status !== "success" || !body.data) {
        return { unavailable: true, reason: "prom_error", series: [] };
      }
      const result = body.data.result ?? [];
      if (result.length === 0) {
        return { unavailable: true, reason: "no_data", series: [] };
      }
      const series: PromSeries[] = result.map((row) => ({
        label: pickLabel(row.metric),
        samples: (row.values ?? []).map(
          ([ts, v]) => [ts, Number.parseFloat(v)] as [number, number],
        ),
      }));
      return { unavailable: false, series };
    } catch (err) {
      this.log.warn(`prom queryRange threw: ${(err as Error).message}`);
      return { unavailable: true, reason: "prom_error", series: [] };
    } finally {
      clearTimeout(timer);
    }
  }
}
