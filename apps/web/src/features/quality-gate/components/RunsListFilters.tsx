import type { GateResult, ListRunsQuery, RunStatus } from "@modeldoctor/contracts";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConnections } from "@/features/connections/queries";
import { DateRangeFilter } from "../../benchmarks/DateRangeFilter";
import { useEvaluations } from "../queries";

const SEARCH_DEBOUNCE_MS = 300;
const ALL = "__all__";

const STATUSES: RunStatus[] = ["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"];
const GATE_RESULTS: GateResult[] = ["PASSED", "WARNING", "FAILED"];

export interface RunsListFiltersProps {
  query: Partial<ListRunsQuery>;
  onChange: (next: Partial<ListRunsQuery>) => void;
}

export function RunsListFilters({ query, onChange }: RunsListFiltersProps) {
  const { t } = useTranslation("quality-gate");
  const { data: evaluations } = useEvaluations();
  const { data: connections } = useConnections();

  function patch(p: Partial<ListRunsQuery>) {
    onChange({ ...query, ...p });
  }

  const [searchDraft, setSearchDraft] = useState(query.search ?? "");
  const lastPushed = useRef(query.search ?? "");
  useEffect(() => {
    const next = query.search ?? "";
    if (next !== lastPushed.current) {
      setSearchDraft(next);
      lastPushed.current = next;
    }
  }, [query.search]);
  useEffect(() => {
    const trimmed = searchDraft.trim();
    if (trimmed === (lastPushed.current || "")) return;
    const handle = window.setTimeout(() => {
      lastPushed.current = trimmed;
      patch({ search: trimmed || undefined });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
    // biome-ignore lint/correctness/useExhaustiveDependencies: patch closes over query but we intentionally only refire on draft change
  }, [searchDraft, patch]);

  const isFiltered =
    query.status !== undefined ||
    query.gateResult !== undefined ||
    query.evaluationId !== undefined ||
    query.endpointId !== undefined ||
    query.search !== undefined ||
    query.createdAfter !== undefined ||
    query.createdBefore !== undefined;

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Select
        value={query.evaluationId ?? ALL}
        onValueChange={(v) => patch({ evaluationId: v === ALL ? undefined : v })}
      >
        <SelectTrigger className="w-[200px]" aria-label={t("runs.filters.evaluation")}>
          <SelectValue placeholder={t("runs.filters.evaluation")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("runs.filters.any")}</SelectItem>
          {(evaluations ?? []).map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={query.endpointId ?? ALL}
        onValueChange={(v) => patch({ endpointId: v === ALL ? undefined : v })}
      >
        <SelectTrigger className="w-[200px]" aria-label={t("runs.filters.endpoint")}>
          <SelectValue placeholder={t("runs.filters.endpoint")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("runs.filters.any")}</SelectItem>
          {(connections ?? []).map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.model} · {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={query.status ?? ALL}
        onValueChange={(v) => patch({ status: v === ALL ? undefined : (v as RunStatus) })}
      >
        <SelectTrigger className="w-[140px]" aria-label={t("runs.filters.status")}>
          <SelectValue placeholder={t("runs.filters.status")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("runs.filters.any")}</SelectItem>
          {STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {t(`runs.status.${s.toLowerCase()}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={query.gateResult ?? ALL}
        onValueChange={(v) => patch({ gateResult: v === ALL ? undefined : (v as GateResult) })}
      >
        <SelectTrigger className="w-[140px]" aria-label={t("runs.filters.gateResult")}>
          <SelectValue placeholder={t("runs.filters.gateResult")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("runs.filters.any")}</SelectItem>
          {GATE_RESULTS.map((g) => (
            <SelectItem key={g} value={g}>
              {t(`runs.gateResult.${g.toLowerCase()}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        placeholder={t("runs.filters.search")}
        className="w-[240px]"
        aria-label={t("runs.filters.search")}
        value={searchDraft}
        onChange={(e) => setSearchDraft(e.target.value)}
      />

      <DateRangeFilter
        startISO={query.createdAfter}
        endISO={query.createdBefore}
        onChange={({ startISO, endISO }) =>
          patch({ createdAfter: startISO, createdBefore: endISO })
        }
      />

      {isFiltered && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            onChange({
              page: query.page,
              pageSize: query.pageSize,
            })
          }
        >
          {t("runs.filters.clear")}
        </Button>
      )}
    </div>
  );
}
