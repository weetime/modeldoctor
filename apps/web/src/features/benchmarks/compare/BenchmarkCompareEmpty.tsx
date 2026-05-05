import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useBenchmarkList } from "../queries";
import { SCENARIOS, type ScenarioId } from "../scenarios";

/**
 * Menu-entry experience for the compare page. The user lands here when
 * they click the top-level "Compare" sidebar item directly (no `?ids=`).
 *
 * Two-step picker:
 *   1. Pick a scenario (filters the benchmark list by `scenario`).
 *   2. Tick 2+ completed benchmarks → "Start comparison" navigates to
 *      `/runs/compare?scenario=<id>&ids=<a,b>`. The compare page itself
 *      then takes over with its existing `?ids=` flow.
 *
 * Phase 14 will rename `/runs/compare` → `/benchmarks/compare`. For now
 * the URL stays as-is to avoid touching the router mid-phase.
 */
export function BenchmarkCompareEmpty() {
  const { t } = useTranslation("runs");
  const navigate = useNavigate();
  const [scenario, setScenario] = useState<ScenarioId | "">("");
  const [selected, setSelected] = useState<string[]>([]);

  // Only fetch the list once a scenario is picked. Without a scenario the
  // list query would still fire (cursor-paginated, all benchmarks); the
  // UX expectation is "scenario first, then list."
  const { data } = useBenchmarkList(scenario ? { scenario } : {});
  const benchmarks =
    scenario && data
      ? data.pages.flatMap((p) => p.items).filter((b) => b.status === "completed")
      : [];

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function handleSubmit() {
    if (!scenario || selected.length < 2) return;
    const sp = new URLSearchParams();
    sp.set("scenario", scenario);
    sp.set("ids", selected.join(","));
    navigate(`/runs/compare?${sp.toString()}`);
  }

  return (
    <>
      <PageHeader title={t("compare.title")} subtitle={t("compare.empty.title")} />
      <div className="space-y-6 px-8 py-6">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="compare-empty-scenario">
            {t("compare.empty.scenarioLabel")}
          </label>
          <select
            id="compare-empty-scenario"
            className="block w-64 rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={scenario}
            onChange={(e) => {
              setScenario(e.target.value as ScenarioId | "");
              setSelected([]); // clear selection when scenario changes
            }}
          >
            <option value="">{t("compare.empty.scenarioPlaceholder")}</option>
            {(Object.keys(SCENARIOS) as ScenarioId[]).map((s) => (
              <option key={s} value={s}>
                {SCENARIOS[s].label}
              </option>
            ))}
          </select>
        </div>

        {scenario ? (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">{t("compare.empty.listTitle")}</h3>
            {benchmarks.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("compare.empty.listEmpty")}</p>
            ) : (
              <ul className="space-y-1">
                {benchmarks.map((b) => (
                  <li key={b.id} className="flex items-center gap-3">
                    <Checkbox
                      id={`compare-empty-bench-${b.id}`}
                      checked={selected.includes(b.id)}
                      onCheckedChange={() => toggle(b.id)}
                    />
                    <label
                      htmlFor={`compare-empty-bench-${b.id}`}
                      className="cursor-pointer text-sm"
                    >
                      {b.name} <span className="text-muted-foreground">({b.tool})</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <div className="pt-2">
              <Button onClick={handleSubmit} disabled={selected.length < 2}>
                {t("compare.empty.submit")}
              </Button>
              {selected.length < 2 ? (
                <span className="ml-3 text-sm text-muted-foreground">
                  {t("compare.empty.needTwo")}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
