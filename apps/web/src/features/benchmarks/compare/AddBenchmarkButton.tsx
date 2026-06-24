import type { BenchmarkTool, ScenarioId } from "@modeldoctor/contracts";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useBenchmarkList } from "@/features/benchmarks/queries";

export interface AddBenchmarkButtonProps {
  /** Restrict candidates to the comparison's scenario + tool so the added run
   *  stays metric-compatible (avoids the mixed-tools / mixed-scenarios guard). */
  scenario: ScenarioId;
  tool: BenchmarkTool;
  /** Already-selected benchmark ids — filtered out of the candidate list. */
  existingIds: string[];
  onAdd: (id: string) => void;
}

export function AddBenchmarkButton({
  scenario,
  tool,
  existingIds,
  onAdd,
}: AddBenchmarkButtonProps) {
  const { t } = useTranslation("benchmarks");
  const [open, setOpen] = useState(false);

  // Only completed runs carry summaryMetrics worth comparing. limit=100 is a
  // single page — comparisons span a handful of runs, not hundreds.
  const { data, isLoading } = useBenchmarkList({
    scenario,
    tool,
    status: "completed",
    limit: 100,
  });

  const existing = useMemo(() => new Set(existingIds), [existingIds]);
  const candidates = useMemo(
    () => (data?.pages.flatMap((p) => p.items) ?? []).filter((b) => !existing.has(b.id)),
    [data, existing],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1">
          <Plus className="h-4 w-4" />
          {t("compare.matrix.add")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <Command
          // Match on name; ids are opaque cuids and not useful to type.
          filter={(value, search) => (value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}
        >
          <CommandInput placeholder={t("compare.matrix.addPlaceholder")} />
          <CommandList>
            <CommandEmpty>
              {isLoading ? t("compare.matrix.addLoading") : t("compare.matrix.addEmpty")}
            </CommandEmpty>
            {candidates.map((b) => (
              <CommandItem
                key={b.id}
                value={b.name}
                onSelect={() => {
                  onAdd(b.id);
                  // Keep the popover open so several runs can be added in a row;
                  // the just-added run drops out of `candidates` on re-render.
                }}
              >
                <span className="truncate">{b.name}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
