import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTemplates } from "@/features/benchmark-templates/queries";
import type { BenchmarkTemplate, ScenarioId } from "@modeldoctor/contracts";
import { Layers, ShieldCheck } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

interface PrefillFromTemplatePopoverProps {
  scenario: ScenarioId;
  onPick: (template: BenchmarkTemplate) => void;
}

export function PrefillFromTemplatePopover({ scenario, onPick }: PrefillFromTemplatePopoverProps) {
  const { t } = useTranslation("benchmarks");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchId = useId();

  const { data } = useTemplates({ scenario, limit: 50 });
  const items = data?.pages.flatMap((p) => p.items) ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        it.name.toLowerCase().includes(q) ||
        (it.description ?? "").toLowerCase().includes(q) ||
        it.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [items, search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Layers className="mr-1 h-4 w-4" />
          {t("create.prefillFromTemplate.button")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        <div className="border-b p-2">
          <Input
            id={searchId}
            aria-label={t("create.prefillFromTemplate.search")}
            placeholder={t("create.prefillFromTemplate.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8"
          />
        </div>
        <div className="max-h-72 overflow-auto">
          {filtered.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground">
              {t("create.prefillFromTemplate.empty")}
            </div>
          ) : (
            <ul className="divide-y">
              {filtered.map((it) => (
                <li key={it.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col gap-1 px-3 py-2 text-left hover:bg-accent"
                    onClick={() => {
                      onPick(it);
                      setOpen(false);
                    }}
                  >
                    <span className="flex items-center gap-1 text-sm font-medium">
                      {it.isOfficial && (
                        <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden />
                      )}
                      <span className="truncate">{it.name}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="text-xs">
                        {it.tool}
                      </Badge>
                      {it.tags.slice(0, 3).map((tag) => (
                        <Badge key={tag} variant="outline" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t p-2">
          <Link
            to={`/benchmark-templates?scenario=${scenario}`}
            className="block px-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setOpen(false)}
          >
            {t("create.prefillFromTemplate.manage")}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
