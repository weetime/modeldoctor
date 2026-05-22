import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { RelativeTime } from "@/components/common/relative-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAlerts } from "./queries";
import type { AlertEventDto } from "./types";

function severityVariant(severity: string): "destructive" | "warning" | "default" | "outline" {
  switch (severity) {
    case "critical":
      return "destructive";
    case "warning":
      return "warning";
    case "info":
      return "outline";
    default:
      return "default";
  }
}

export function AlertsPage() {
  const { t } = useTranslation("alerts");
  const { data: alerts, isLoading } = useAlerts();

  return (
    <>
      <PageHeader title={t("page.title")} subtitle={t("page.subtitle")} />
      <div className="px-8 py-6 space-y-6">
        {isLoading ? (
          <div className="space-y-2">
            <div className="h-12 w-full animate-pulse rounded bg-muted" />
            <div className="h-12 w-full animate-pulse rounded bg-muted" />
            <div className="h-12 w-full animate-pulse rounded bg-muted" />
          </div>
        ) : !alerts || alerts.length === 0 ? (
          <EmptyState icon={AlertTriangle} title={t("empty.title")} body={t("empty.body")} />
        ) : (
          <AlertsTable alerts={alerts} />
        )}
      </div>
    </>
  );
}

function AlertsTable({ alerts }: { alerts: AlertEventDto[] }) {
  const { t } = useTranslation("alerts");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10" />
          <TableHead>{t("col.alertName")}</TableHead>
          <TableHead>{t("col.severity")}</TableHead>
          <TableHead>{t("col.status")}</TableHead>
          <TableHead>{t("col.model")}</TableHead>
          <TableHead>{t("col.scenario")}</TableHead>
          <TableHead>{t("col.startedAt")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {alerts.map((a) => {
          const isOpen = expanded.has(a.id);
          return (
            <Fragment key={a.id}>
              <TableRow className="cursor-pointer" onClick={() => toggle(a.id)}>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    aria-label={isOpen ? t("row.collapse") : t("row.expand")}
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </Button>
                </TableCell>
                <TableCell className="font-mono text-sm">{a.alertName}</TableCell>
                <TableCell>
                  <Badge variant={severityVariant(a.severity)}>{a.severity}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={a.status === "firing" ? "destructive" : "outline"}>
                    {a.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">
                  {a.modelName ?? <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{a.scenario ?? "—"}</TableCell>
                <TableCell>
                  <RelativeTime date={a.startsAt} />
                </TableCell>
              </TableRow>
              {isOpen && (
                <TableRow>
                  <TableCell colSpan={7} className="bg-muted/30">
                    <AlertDetailPanel alert={a} />
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}

function AlertDetailPanel({ alert }: { alert: AlertEventDto }) {
  const { t } = useTranslation("alerts");
  return (
    <div className="space-y-4 py-3">
      {alert.annotations.summary && (
        <div>
          <div className="text-xs font-semibold uppercase text-muted-foreground">
            {t("detail.summary")}
          </div>
          <div className="mt-1 text-sm">{alert.annotations.summary}</div>
        </div>
      )}
      {alert.annotations.description && (
        <div>
          <div className="text-xs font-semibold uppercase text-muted-foreground">
            {t("detail.description")}
          </div>
          <div className="mt-1 whitespace-pre-wrap text-sm">{alert.annotations.description}</div>
        </div>
      )}

      {alert.explanation ? (
        <div className="rounded-md border border-border bg-background p-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase text-muted-foreground">
              {t("detail.aiNarrative")}
            </span>
            <Badge variant={severityVariant(alert.explanation.aiSeverity)}>
              {t("detail.aiSeverity")}: {alert.explanation.aiSeverity}
            </Badge>
            <span className="ml-auto text-xs text-muted-foreground">
              <RelativeTime date={alert.explanation.generatedAt} />
            </span>
          </div>
          <div className="prose prose-sm mt-3 max-w-none whitespace-pre-wrap text-sm">
            {alert.explanation.narrative}
          </div>
          {alert.explanation.recommendations.length > 0 && (
            <div className="mt-4">
              <div className="text-xs font-semibold uppercase text-muted-foreground">
                {t("detail.recommendations")}
              </div>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
                {alert.explanation.recommendations.map((r, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: rec list is immutable per alert
                  <li key={i}>{r}</li>
                ))}
              </ol>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          {t("detail.noExplanation")}
        </div>
      )}

      <div>
        <div className="text-xs font-semibold uppercase text-muted-foreground">
          {t("detail.labels")}
        </div>
        <pre className="mt-1 overflow-x-auto rounded bg-muted p-3 text-xs">
          {JSON.stringify(alert.labels, null, 2)}
        </pre>
      </div>
    </div>
  );
}
