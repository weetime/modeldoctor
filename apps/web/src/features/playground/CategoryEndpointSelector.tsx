import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConnectionsStore } from "@/stores/connections-store";
import type { ModalityCategory } from "@modeldoctor/contracts";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

export interface CategoryEndpointSelectorProps {
  category: ModalityCategory;
  selectedConnectionId: string | null;
  onSelect: (id: string | null) => void;
}

export function CategoryEndpointSelector({
  category,
  selectedConnectionId,
  onSelect,
}: CategoryEndpointSelectorProps) {
  const { t } = useTranslation("playground");
  const { t: tc } = useTranslation("connections");
  const list = useConnectionsStore((s) => s.list());
  const [showAll, setShowAll] = useState(false);

  const visible = showAll ? list : list.filter((c) => c.category === category);
  const selected = selectedConnectionId
    ? (list.find((c) => c.id === selectedConnectionId) ?? null)
    : null;
  const mismatched = selected && selected.category !== category;
  const showAllId = useId();

  return (
    <div className="space-y-2">
      <Select value={selectedConnectionId ?? ""} onValueChange={(v) => onSelect(v || null)}>
        <SelectTrigger className="w-full">
          <SelectValue
            placeholder={t("endpoint.noMatchingConnections", {
              category: tc(`dialog.categoryOptions.${category}`),
            })}
          />
        </SelectTrigger>
        <SelectContent>
          {visible.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              {t("endpoint.noMatchingConnections", {
                category: tc(`dialog.categoryOptions.${category}`),
              })}
            </div>
          ) : (
            visible.map((c) => (
              <SelectItem
                key={c.id}
                value={c.id}
                className={c.category !== category ? "opacity-60" : ""}
              >
                {c.name}
              </SelectItem>
            ))
          )}
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
