import type { BenchmarkTemplate } from "@modeldoctor/contracts";
import { MoreHorizontal, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface TemplateCardProps {
  template: BenchmarkTemplate;
  canEdit: boolean;
  onDeleteClick: () => void;
}

export function TemplateCard({ template, canEdit, onDeleteClick }: TemplateCardProps) {
  const { t } = useTranslation("benchmark-templates");
  return (
    <div className="group relative flex flex-col gap-3 rounded-lg border border-border bg-card p-4 transition hover:border-primary/40">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {template.isOfficial && <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />}
            <Link
              to={`/benchmark-templates/${template.id}`}
              className="truncate text-sm font-semibold hover:text-primary hover:underline"
            >
              {template.name}
            </Link>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="text-xs">
            {template.tool}
          </Badge>
          {template.isOfficial && (
            <Badge variant="default" className="text-xs">
              {t("list.official")}
            </Badge>
          )}
          {template.tags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
        <p className="line-clamp-2 text-xs text-muted-foreground">{template.description || ""}</p>
        <p className="text-xs text-muted-foreground">
          {t("list.updatedAt", {
            when: new Date(template.updatedAt).toLocaleString(),
          })}
        </p>
      </div>

      <div className="flex justify-end">
        <Button asChild size="sm">
          <Link to={`/benchmarks/new?scenario=${template.scenario}&templateId=${template.id}`}>
            {t("list.cards.useThisTemplate")}
          </Link>
        </Button>
      </div>

      {canEdit && (
        <div className="absolute right-2 top-2 opacity-0 transition group-hover:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to={`/benchmark-templates/${template.id}`}>{t("actions.edit")}</Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onClick={(e) => {
                  e.preventDefault();
                  onDeleteClick();
                }}
              >
                {t("actions.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
