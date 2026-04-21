export const API_TYPES = [
	"chat",
	"embeddings",
	"rerank",
	"images",
	"chat-vision",
	"chat-audio",
] as const;

export type ApiType = (typeof API_TYPES)[number];

export interface LoadTestParsed {
	requests: number | null;
	success: number | null;
	throughput: number | null;
	latencies: {
		mean: string | null;
		p50: string | null;
		p95: string | null;
		p99: string | null;
		max: string | null;
	};
}

export interface LoadTestResult {
	report: string;
	parsed: LoadTestParsed;
	config: Record<string, unknown>;
}
