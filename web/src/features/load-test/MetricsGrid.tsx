import { useTranslation } from "react-i18next";
import type { LoadTestParsed } from "./types";

interface Metric {
	label: string;
	value: string;
	unit?: string;
}

export function MetricsGrid({ parsed }: { parsed: LoadTestParsed }) {
	const { t } = useTranslation("load-test");
	const metrics: Metric[] = [
		{ label: t("metrics.totalRequests"), value: String(parsed.requests ?? "\u2014") },
		{
			label: t("metrics.successRate"),
			value: parsed.success !== null ? parsed.success.toFixed(2) : "\u2014",
			unit: "%",
		},
		{
			label: t("metrics.throughput"),
			value: parsed.throughput !== null ? parsed.throughput.toFixed(2) : "\u2014",
			unit: "req/s",
		},
		{ label: t("metrics.meanLatency"), value: parsed.latencies.mean ?? "\u2014" },
		{ label: t("metrics.p50"), value: parsed.latencies.p50 ?? "\u2014" },
		{ label: t("metrics.p95"), value: parsed.latencies.p95 ?? "\u2014" },
		{ label: t("metrics.p99"), value: parsed.latencies.p99 ?? "\u2014" },
		{ label: t("metrics.maxLatency"), value: parsed.latencies.max ?? "\u2014" },
	];
	return (
		<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
			{metrics.map((m) => (
				<div key={m.label} className="rounded-lg border border-border bg-card p-3">
					<div className="text-[11px] uppercase tracking-wide text-muted-foreground">
						{m.label}
					</div>
					<div className="mt-1 font-mono text-xl font-semibold tabular-nums">
						{m.value}
						{m.unit ? (
							<span className="ml-1 text-xs text-muted-foreground">{m.unit}</span>
						) : null}
					</div>
				</div>
			))}
		</div>
	);
}
