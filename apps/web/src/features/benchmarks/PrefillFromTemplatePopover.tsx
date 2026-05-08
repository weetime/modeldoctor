import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { useTemplates } from "@/features/benchmark-templates/queries";
import type { BenchmarkTemplate, ScenarioId } from "@modeldoctor/contracts";
import { Layers, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

interface PrefillFromTemplatePopoverProps {
  scenario: ScenarioId;
  onPick: (template: BenchmarkTemplate) => void;
}

export function PrefillFromTemplatePopover({ scenario, onPick }: PrefillFromTemplatePopoverProps) {
  const { t } = useTranslation("benchmarks");
  const { data } = useTemplates({ scenario, limit: 50 });
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
      renderItem={(it) => (
        <div className="flex w-full flex-col gap-1">
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
        </div>
      )}
      searchPlaceholder={t("create.prefillFromTemplate.search")}
      emptyText={t("create.prefillFromTemplate.empty")}
      align="end"
      contentClassName="w-96"
      trigger={
        <Button type="button" variant="outline" size="sm">
          <Layers className="mr-1 h-4 w-4" />
          {t("create.prefillFromTemplate.button")}
        </Button>
      }
      footer={
        <Link
          to={`/benchmark-templates?scenario=${scenario}`}
          className="block px-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {t("create.prefillFromTemplate.manage")}
        </Link>
      }
    />
  );
}
