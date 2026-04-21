import { PageHeader } from "@/components/common/page-header";
import { EndpointSelector } from "@/components/connection/EndpointSelector";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api-client";
import { useConnectionsStore } from "@/stores/connections-store";
import { useTranslation } from "react-i18next";
import { ProbeCard } from "./ProbeCard";
import { useE2EStore } from "./store";
import type { ProbeName, ProbeResult } from "./types";

interface E2EApiResponse {
	success: boolean;
	results: Array<{ probe: ProbeName } & ProbeResult>;
	error?: string;
}

export function E2ESmokePage() {
	const { t } = useTranslation("e2e");
	const slice = useE2EStore();
	const conns = useConnectionsStore();
	const conn = slice.selectedConnectionId
		? conns.get(slice.selectedConnectionId)
		: null;

	const runProbes = async (probes: ProbeName[]) => {
		if (!conn) {
			alert("Please select a connection.");
			return;
		}
		for (const p of probes) slice.setRunning(p, true);
		try {
			const data = await api.post<E2EApiResponse>("/api/e2e-test", {
				apiUrl: conn.apiUrl,
				apiKey: conn.apiKey,
				model: conn.model,
				customHeaders: conn.customHeaders,
				probes,
			});
			if (!data.success) {
				for (const p of probes) {
					slice.setResult(p, {
						pass: false,
						latencyMs: null,
						checks: [{ name: "request", pass: false, info: data.error }],
						details: { error: data.error ?? "unknown" },
					});
				}
				return;
			}
			for (const r of data.results) {
				slice.setResult(r.probe, r);
			}
		} catch (e) {
			const msg = e instanceof ApiError ? e.message : "network";
			for (const p of probes) {
				slice.setResult(p, {
					pass: false,
					latencyMs: null,
					checks: [{ name: "request", pass: false, info: msg }],
					details: { error: msg },
				});
			}
		} finally {
			for (const p of probes) slice.setRunning(p, false);
		}
	};

	return (
		<>
			<PageHeader
				title={t("title")}
				subtitle={t("subtitle")}
				rightSlot={
					<EndpointSelector
						selectedId={slice.selectedConnectionId}
						modified={false}
						onSelect={slice.setSelected}
					/>
				}
			/>
			<div className="space-y-4 px-8 py-6">
				<div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
					{(["text", "image", "audio"] as ProbeName[]).map((p) => (
						<ProbeCard
							key={p}
							name={p}
							result={slice.results[p]}
							running={slice.running[p]}
							onRun={() => runProbes([p])}
						/>
					))}
				</div>
				<div className="flex gap-2">
					<Button onClick={() => runProbes(["text", "image", "audio"])}>
						{t("actions.runAll")}
					</Button>
					<Button variant="ghost" onClick={() => slice.clearAll()}>
						{t("actions.clear")}
					</Button>
				</div>
			</div>
		</>
	);
}
