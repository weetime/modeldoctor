import { PageHeader } from "@/components/common/page-header";
import { EndpointPicker } from "@/components/connection/EndpointPicker";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api-client";
import { useTranslation } from "react-i18next";
import { ProbeCard } from "./ProbeCard";
import { useE2EStore } from "./store";
import type { E2ETestResponse, ProbeName } from "./types";

export function E2ESmokePage() {
  const { t } = useTranslation("e2e");
  const { t: tc } = useTranslation("common");
  const slice = useE2EStore();
  const endpoint = slice.manualEndpoint;

  const canRun =
    endpoint.apiBaseUrl.trim().length > 0 &&
    endpoint.apiKey.trim().length > 0 &&
    endpoint.model.trim().length > 0;
  const disabledReason = canRun ? undefined : tc("errors.required");

  const runProbes = async (probes: ProbeName[]) => {
    if (!canRun) return;
    for (const p of probes) slice.setRunning(p, true);
    try {
      const data = await api.post<E2ETestResponse>("/api/e2e-test", {
        apiBaseUrl: endpoint.apiBaseUrl,
        apiKey: endpoint.apiKey,
        model: endpoint.model,
        customHeaders: endpoint.customHeaders,
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
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="space-y-6 px-8 py-6">
        <EndpointPicker
          endpoint={endpoint}
          selectedConnectionId={slice.selectedConnectionId}
          onSelect={(id) => {
            slice.setSelected(id);
            slice.resetResults();
          }}
          onEndpointChange={slice.setManualEndpoint}
        />

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {(["text", "image", "audio"] as ProbeName[]).map((p) => (
            <ProbeCard
              key={p}
              name={p}
              result={slice.results[p]}
              running={slice.running[p]}
              onRun={() => runProbes([p])}
              disabledReason={disabledReason}
            />
          ))}
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => runProbes(["text", "image", "audio"])}
            disabled={!canRun}
            title={disabledReason}
          >
            {t("actions.runAll")}
          </Button>
          <Button variant="ghost" onClick={() => slice.resetResults()}>
            {t("actions.clear")}
          </Button>
        </div>
      </div>
    </>
  );
}
