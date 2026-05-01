import type {
  LatencyCDFSeries,
  PercentileTimeseriesSeries,
  QPSTimeseriesSeries,
  TTFTHistogramSeries,
} from "@/components/charts";

const RUN_IDS = ["run-a", "run-b", "run-c"] as const;

function genTimeseries(n: number, base: number, jitter: number): Array<[number, number]> {
  const start = Date.now() - n * 100;
  const out: Array<[number, number]> = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = [start + i * 100, base + (Math.random() - 0.5) * jitter];
  }
  return out;
}

function genSamples(n: number, mean: number, sigma: number): number[] {
  // Box–Muller approximation for a roughly-normal distribution.
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const u1 = Math.random() || 1e-9;
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    out[i] = Math.max(0, mean + z * sigma);
  }
  return out;
}

function genBuckets(centerBin: number, peak: number) {
  return Array.from({ length: 10 }, (_, i) => ({
    lower: i * 50,
    upper: (i + 1) * 50,
    count: Math.max(0, Math.floor(peak - Math.abs(i - centerBin) * 12)),
  }));
}

export const RUN_ID_LIST: readonly string[] = RUN_IDS;

export const fixtures = {
  threeRunPercentile: RUN_IDS.map(
    (id, i): PercentileTimeseriesSeries => ({
      runId: id,
      runLabel: `Run ${i + 1}`,
      percentiles: {
        p50: genTimeseries(50, 100 + i * 10, 30),
        p95: genTimeseries(50, 200 + i * 20, 50),
        p99: genTimeseries(50, 300 + i * 30, 80),
      },
    }),
  ),
  threeRunCDF: RUN_IDS.map(
    (id, i): LatencyCDFSeries => ({
      runId: id,
      runLabel: `Run ${i + 1}`,
      samples: genSamples(500, 200 + i * 50, 80),
    }),
  ),
  threeRunHistogram: RUN_IDS.map(
    (id, i): TTFTHistogramSeries => ({
      runId: id,
      runLabel: `Run ${i + 1}`,
      buckets: genBuckets(4 + i, 80),
    }),
  ),
  threeRunQPS: RUN_IDS.map(
    (id, i): QPSTimeseriesSeries => ({
      runId: id,
      runLabel: `Run ${i + 1}`,
      points: genTimeseries(50, 50 + i * 10, 15),
    }),
  ),
  largePercentile: [
    {
      runId: "large",
      runLabel: "10k points",
      percentiles: {
        p50: genTimeseries(10_000, 100, 30),
        p95: genTimeseries(10_000, 200, 50),
      },
    },
  ] satisfies PercentileTimeseriesSeries[],
  largeCDF: [
    { runId: "large", runLabel: "10k samples", samples: genSamples(10_000, 200, 80) },
  ] satisfies LatencyCDFSeries[],
  largeHistogram: [
    {
      runId: "large",
      runLabel: "10k buckets",
      buckets: Array.from({ length: 10_000 }, (_, i) => ({
        lower: i,
        upper: i + 1,
        count: Math.floor(Math.random() * 100),
      })),
    },
  ] satisfies TTFTHistogramSeries[],
  largeQPS: [
    { runId: "large", runLabel: "10k points", points: genTimeseries(10_000, 50, 15) },
  ] satisfies QPSTimeseriesSeries[],
};
