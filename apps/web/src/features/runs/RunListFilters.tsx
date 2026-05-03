import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ListRunsQuery, RunKind, RunStatus, RunTool } from "@modeldoctor/contracts";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

const SEARCH_DEBOUNCE_MS = 300;

const ALL = "__all__";

const KINDS: RunKind[] = ["benchmark", "e2e"];
const TOOLS: RunTool[] = ["guidellm", "genai-perf", "vegeta", "e2e", "custom"];
const STATUSES: RunStatus[] = [
  "pending",
  "submitted",
  "running",
  "completed",
  "failed",
  "canceled",
];

export interface RunListFiltersProps {
  query: Partial<ListRunsQuery>;
  onChange: (next: Partial<ListRunsQuery>) => void;
}

export function RunListFilters({ query, onChange }: RunListFiltersProps) {
  const { t } = useTranslation("runs");

  function patch(p: Partial<ListRunsQuery>) {
    onChange({ ...query, ...p });
  }

  // Local search state, debounced before pushing into the URL/query. Without
  // this the input fires a network request on every keystroke (gemini PR #67
  // review). The query.search → state sync handles "Clear all" + back/forward.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  const isFiltered =
    query.kind !== undefined ||
    query.tool !== undefined ||
    query.status !== undefined ||
    query.connectionId !== undefined ||
    query.search !== undefined ||
    query.createdAfter !== undefined ||
    query.createdBefore !== undefined ||
    query.isBaseline !== undefined ||
    query.referencesBaseline !== undefined;

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Select
        value={query.kind ?? ALL}
        onValueChange={(v) => patch({ kind: v === ALL ? undefined : (v as RunKind) })}
      >
        <SelectTrigger className="w-[140px]" aria-label={t("filters.kind")}>
          <SelectValue placeholder={t("filters.kind")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("filters.any")}</SelectItem>
          {KINDS.map((k) => (
            <SelectItem key={k} value={k}>
              {k}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={query.tool ?? ALL}
        onValueChange={(v) => patch({ tool: v === ALL ? undefined : (v as RunTool) })}
      >
        <SelectTrigger className="w-[160px]" aria-label={t("filters.tool")}>
          <SelectValue placeholder={t("filters.tool")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("filters.any")}</SelectItem>
          {TOOLS.map((tool) => (
            <SelectItem key={tool} value={tool}>
              {tool}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={query.status ?? ALL}
        onValueChange={(v) => patch({ status: v === ALL ? undefined : (v as RunStatus) })}
      >
        <SelectTrigger className="w-[160px]" aria-label={t("filters.status")}>
          <SelectValue placeholder={t("filters.status")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("filters.any")}</SelectItem>
          {STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={query.isBaseline ? "is" : query.referencesBaseline ? "ref" : ALL}
        onValueChange={(v) => {
          if (v === ALL) patch({ isBaseline: undefined, referencesBaseline: undefined });
          else if (v === "is") patch({ isBaseline: true, referencesBaseline: undefined });
          else if (v === "ref") patch({ isBaseline: undefined, referencesBaseline: true });
        }}
      >
        <SelectTrigger className="w-[180px]" aria-label={t("filters.baseline")}>
          <SelectValue placeholder={t("filters.baseline")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("filters.any")}</SelectItem>
          <SelectItem value="is">{t("filters.baselineIs")}</SelectItem>
          <SelectItem value="ref">{t("filters.baselineRef")}</SelectItem>
        </SelectContent>
      </Select>

      <Input
        placeholder={t("filters.search")}
        className="w-[220px]"
        aria-label={t("filters.search")}
        value={searchDraft}
        onChange={(e) => setSearchDraft(e.target.value)}
      />

      <div className="flex items-center gap-1 text-sm">
        <span className="text-muted-foreground">{t("filters.createdAfter")}</span>
        <Input
          type="datetime-local"
          className="w-[200px]"
          aria-label={t("filters.createdAfter")}
          value={query.createdAfter?.slice(0, 16) ?? ""}
          onChange={(e) =>
            patch({
              createdAfter: e.target.value ? new Date(e.target.value).toISOString() : undefined,
            })
          }
        />
      </div>

      <div className="flex items-center gap-1 text-sm">
        <span className="text-muted-foreground">{t("filters.createdBefore")}</span>
        <Input
          type="datetime-local"
          className="w-[200px]"
          aria-label={t("filters.createdBefore")}
          value={query.createdBefore?.slice(0, 16) ?? ""}
          onChange={(e) =>
            patch({
              createdBefore: e.target.value ? new Date(e.target.value).toISOString() : undefined,
            })
          }
        />
      </div>

      {isFiltered && (
        <Button variant="ghost" size="sm" onClick={() => onChange({ limit: query.limit })}>
          {t("filters.clear")}
        </Button>
      )}
    </div>
  );
}
