import type { BenchmarkTemplate, ModalityCategory, ScenarioId } from "@modeldoctor/contracts";
import { Layers, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { useTemplates } from "@/features/benchmark-templates/queries";

interface PrefillFromTemplatePopoverProps {
  scenario: ScenarioId;
  /**
   * Connection category to filter templates by. When set, only templates
   * whose `categories` array includes this value are shown. When `null`,
   * no category filter — all scenario templates show. The user can also
   * toggle "show all" from inside the popover to bypass the filter.
   */
  category: ModalityCategory | null;
  onPick: (template: BenchmarkTemplate) => void;
}

export function PrefillFromTemplatePopover({
  scenario,
  category,
  onPick,
}: PrefillFromTemplatePopoverProps) {
  const { t } = useTranslation("benchmarks");
  const [showAll, setShowAll] = useState(false);
  const effectiveCategory = showAll ? undefined : (category ?? undefined);
  const { data } = useTemplates({ scenario, category: effectiveCategory, limit: 50 });
  const items = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Combobox<BenchmarkTemplate>
      items={items}
      value={null}
      onChange={(tpl) => {
        if (tpl) onPick(tpl);
      }}
      getKey={(it) => it.id}
      getLabel={(it) => it.name}
      getSearchText={(it) => [it.name, it.description ?? "", ...it.tags].join(" ")}
      renderItem={(it) => (
        <div className="flex w-full flex-col gap-1">
          <span className="flex items-center gap-1 text-sm font-medium">
            {it.isOfficial && <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden />}
            <span className="truncate">{it.name}</span>
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="text-xs">
              {it.tool}
            </Badge>
            {it.categories.map((c) => (
              <Badge key={c} variant="outline" className="text-xs">
                {t(`create.prefillFromTemplate.categoryBadge.${c}`, { defaultValue: c })}
              </Badge>
            ))}
            {it.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="outline" className="text-xs">
                {tag}
              </Badge>
            ))}
          </span>
        </div>
      )}
      searchPlaceholder={t("create.prefillFromTemplate.search")}
      emptyText={
        category && !showAll
          ? t("create.prefillFromTemplate.emptyForCategory", { category })
          : t("create.prefillFromTemplate.empty")
      }
      align="end"
      contentClassName="w-96"
      trigger={
        <Button type="button" variant="outline" size="sm">
          <Layers className="mr-1 h-4 w-4" />
          {t("create.prefillFromTemplate.button")}
        </Button>
      }
      footer={
        <div className="flex items-center justify-between px-1 text-xs">
          {category ? (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="text-muted-foreground hover:text-foreground"
            >
              {showAll
                ? t("create.prefillFromTemplate.filterByCategory", { category })
                : t("create.prefillFromTemplate.showAll")}
            </button>
          ) : (
            <span />
          )}
          <Link
            to={`/benchmark-templates?scenario=${scenario}`}
            className="text-muted-foreground hover:text-foreground"
          >
            {t("create.prefillFromTemplate.manage")}
          </Link>
        </div>
      }
    />
  );
}
