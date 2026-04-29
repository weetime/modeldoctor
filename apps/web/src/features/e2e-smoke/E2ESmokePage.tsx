import { PageHeader } from "@/components/common/page-header";
import { EndpointPicker } from "@/components/connection/EndpointPicker";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError, api } from "@/lib/api-client";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ProbeCard } from "./ProbeCard";
import { useE2EStore } from "./store";
import type { E2ETestResponse, ProbeCategory, ProbeName, ProbeResult } from "./types";
import { PROBES_BY_CATEGORY } from "./types";

const CATEGORIES: ProbeCategory[] = ["chat", "audio", "embeddings", "rerank", "image"];

export function E2ESmokePage() {
  const { t } = useTranslation("e2e");
  const { t: tc } = useTranslation("common");
  const slice = useE2EStore();
  const endpoint = slice.manualEndpoint;
  const probesInCategory = PROBES_BY_CATEGORY[slice.selectedCategory];

  const canRun =
    endpoint.apiBaseUrl.trim().length > 0 &&
    endpoint.apiKey.trim().length > 0 &&
    endpoint.model.trim().length > 0;
  const disabledReason = canRun ? undefined : tc("errors.required");

  const notifyFailures = (entries: { probe: ProbeName; result: ProbeResult }[]) => {
    for (const { probe, result } of entries) {
      if (result.pass) continue;
      const failedCheck = result.checks.find((c) => !c.pass);
      const reason = failedCheck
        ? `${failedCheck.name}${failedCheck.info ? ` (${failedCheck.info})` : ""}`
        : (result.details.error ?? "unknown");
      toast.error(t(`probes.${probe}.title`), { description: reason });
    }
  };

  const runProbes = async (probes: ProbeName[]) => {
    if (!canRun) return;
    for (const p of probes) slice.setRunning(p, true);
    try {
      const overridesEntries = probes
        .filter((p) => slice.pathOverrides[p] !== undefined)
        .map((p) => [p, slice.pathOverrides[p] as string] as const);
      const data = await api.post<E2ETestResponse>("/api/e2e-test", {
        apiBaseUrl: endpoint.apiBaseUrl,
        apiKey: endpoint.apiKey,
        model: endpoint.model,
        customHeaders: endpoint.customHeaders,
        probes,
        ...(overridesEntries.length > 0
          ? { pathOverride: Object.fromEntries(overridesEntries) }
          : {}),
      });
      if (!data.success) {
        const failed: { probe: ProbeName; result: ProbeResult }[] = [];
        for (const p of probes) {
          const result: ProbeResult = {
            pass: false,
            latencyMs: null,
            checks: [{ name: "request", pass: false, info: data.error }],
            details: { error: data.error ?? "unknown" },
          };
          slice.setResult(p, result);
          failed.push({ probe: p, result });
        }
        notifyFailures(failed);
        return;
      }
      for (const r of data.results) {
        slice.setResult(r.probe, r);
      }
      notifyFailures(data.results.map((r) => ({ probe: r.probe, result: r })));
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "network";
      const failed: { probe: ProbeName; result: ProbeResult }[] = [];
      for (const p of probes) {
        const result: ProbeResult = {
          pass: false,
          latencyMs: null,
          checks: [{ name: "request", pass: false, info: msg }],
          details: { error: msg },
        };
        slice.setResult(p, result);
        failed.push({ probe: p, result });
      }
      notifyFailures(failed);
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

        <div className="flex items-center gap-3">
          <label htmlFor="e2e-category-select" className="text-sm font-medium">
            {t("category.label")}
          </label>
          <Select
            value={slice.selectedCategory}
            onValueChange={(v) => slice.setSelectedCategory(v as ProbeCategory)}
          >
            <SelectTrigger id="e2e-category-select" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {t(`category.options.${c}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {probesInCategory.map((p) => (
            <ProbeCard
              key={p}
              name={p}
              result={slice.results[p] ?? null}
              running={!!slice.running[p]}
              pathOverride={slice.pathOverrides[p]}
              onPathChange={(next) => slice.setPathOverride(p, next)}
              onPathReset={() => slice.clearPathOverride(p)}
              onRun={() => runProbes([p])}
              disabledReason={disabledReason}
            />
          ))}
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => runProbes([...probesInCategory])}
            disabled={!canRun}
            title={disabledReason}
          >
            {t("actions.runCategory", {
              category: t(`category.options.${slice.selectedCategory}`),
            })}
          </Button>
          <Button variant="ghost" onClick={() => slice.resetResults()}>
            {t("actions.clear")}
          </Button>
        </div>
      </div>
    </>
  );
}
