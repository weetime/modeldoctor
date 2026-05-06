import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

interface Props {
  startISO: string | undefined;
  endISO: string | undefined;
  onChange: (next: { startISO?: string; endISO?: string }) => void;
}

/**
 * Single-component visual treatment for a `[start, end]` datetime range.
 * Wraps two native `datetime-local` inputs in a shared border so the user
 * reads them as one filter, with an arrow between and a clear button on the
 * right when either bound is set. We keep two separate inputs (rather than a
 * popover-driven calendar) to avoid pulling in `react-day-picker` for this
 * one screen.
 */
export function DateRangeFilter({ startISO, endISO, onChange }: Props) {
  const { t } = useTranslation("benchmarks");
  const hasValue = !!(startISO || endISO);
  return (
    <div className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-2 py-1 text-sm">
      <input
        type="datetime-local"
        aria-label={t("filters.createdAfter")}
        value={startISO?.slice(0, 16) ?? ""}
        onChange={(e) =>
          onChange({
            startISO: e.target.value ? new Date(e.target.value).toISOString() : undefined,
            endISO,
          })
        }
        max={endISO?.slice(0, 16)}
        className="bg-transparent px-1 outline-none"
      />
      <span className="text-muted-foreground">→</span>
      <input
        type="datetime-local"
        aria-label={t("filters.createdBefore")}
        value={endISO?.slice(0, 16) ?? ""}
        onChange={(e) =>
          onChange({
            startISO,
            endISO: e.target.value ? new Date(e.target.value).toISOString() : undefined,
          })
        }
        min={startISO?.slice(0, 16)}
        className="bg-transparent px-1 outline-none"
      />
      {hasValue ? (
        <button
          type="button"
          aria-label={t("filters.clearRange")}
          onClick={() => onChange({ startISO: undefined, endISO: undefined })}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}
