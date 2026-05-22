import type { ConnectionPublic, ModalityCategory } from "@modeldoctor/contracts";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConnections } from "@/features/connections/queries";

const NEW_CONNECTION = "__new__";

export interface CategoryEndpointSelectorProps {
  category: ModalityCategory;
  selectedConnectionId: string | null;
  onSelect: (id: string | null) => void;
}

/**
 * Playground connection picker. Uses the same 3-line SelectItem layout
 * (model · name + baseUrl) and "+ New connection" affordance as
 * `ConnectionPicker` (used in BenchmarkCreatePage), so all in-app picker
 * surfaces look identical. The Playground-specific bits stay here:
 *   - default-filter to the current modality category
 *   - "show all" override toggle for cross-category selection
 *   - mismatch warning banner when the user picks a different-category one
 */
export function CategoryEndpointSelector({
  category,
  selectedConnectionId,
  onSelect,
}: CategoryEndpointSelectorProps) {
  const { t } = useTranslation("playground");
  const { t: tc } = useTranslation("connections");
  const { t: tCommon } = useTranslation("common");
  const listQuery = useConnections();
  const list: ConnectionPublic[] = listQuery.data ?? [];
  const [showAll, setShowAll] = useState(false);

  const visible = showAll ? list : list.filter((c) => c.category === category);
  const selected = selectedConnectionId
    ? (list.find((c) => c.id === selectedConnectionId) ?? null)
    : null;
  const mismatched = selected && selected.category !== category;
  const showAllId = useId();

  function handleSelectValue(value: string) {
    if (value === NEW_CONNECTION) {
      // Use window.location instead of useNavigate so this component stays
      // testable in isolation (no Router context required).
      window.location.assign("/connections");
      return;
    }
    onSelect(value || null);
  }

  return (
    <div className="space-y-2">
      <Select value={selectedConnectionId ?? ""} onValueChange={handleSelectValue}>
        <SelectTrigger className="w-full">
          <SelectValue
            placeholder={t(
              visible.length === 0 ? "endpoint.noMatchingConnections" : "endpoint.pickConnection",
              { category: tc(`dialog.categoryOptions.${category}`) },
            )}
          >
            {selected ? selected.model : null}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {visible.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              {t("endpoint.noMatchingConnections", {
                category: tc(`dialog.categoryOptions.${category}`),
              })}
            </div>
          ) : (
            visible.map((c) => {
              const mismatch = c.category !== category;
              return (
                <SelectItem
                  key={c.id}
                  value={c.id}
                  className={`py-2 ${mismatch ? "opacity-60" : ""}`}
                  title={
                    mismatch
                      ? t("endpoint.categoryMismatchHint", {
                          category: tc(`dialog.categoryOptions.${c.category}`),
                        })
                      : undefined
                  }
                >
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-baseline gap-2 text-sm">
                      <span className="font-medium">{c.model}</span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="text-xs text-muted-foreground">{c.name}</span>
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground/70">
                      {c.baseUrl}
                    </div>
                  </div>
                </SelectItem>
              );
            })
          )}
          <SelectSeparator />
          <SelectItem value={NEW_CONNECTION}>{tCommon("endpoint.newConnection")}</SelectItem>
        </SelectContent>
      </Select>

      <label htmlFor={showAllId} className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          id={showAllId}
          type="checkbox"
          checked={showAll}
          onChange={(e) => setShowAll(e.target.checked)}
        />
        {t("endpoint.showAll")}
      </label>

      {mismatched ? (
        <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-xs text-warning">
          <span>
            {t("endpoint.categoryMismatch", {
              category: tc(`dialog.categoryOptions.${selected?.category}`),
            })}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={() => onSelect(null)}
          >
            {t("endpoint.clearSelection")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
