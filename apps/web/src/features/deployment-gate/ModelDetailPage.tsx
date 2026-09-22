import { Play, Settings2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/page-header";
import { RelativeTime } from "@/components/common/relative-time";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AutomationSheet } from "./AutomationSheet";
import {
  useCancelAutomationRun,
  useDiscoveredModel,
  useRevisions,
  useRoutes,
  useRunDiscoveredModel,
  useUpdateDiscoveredModel,
} from "./queries";
import { RevisionTimeline } from "./RevisionTimeline";
import { ModelStatusBadge } from "./VerdictBadge";

export function ModelDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation("deployment-gate");
  const { t: tSidebar } = useTranslation("sidebar");
  const model = useDiscoveredModel(id);
  const active =
    model.data?.lastRun?.status === "pending" || model.data?.lastRun?.status === "running";
  const revisions = useRevisions(id, { poll: active });
  const routes = useRoutes(model.data?.status === "unroutable" ? model.data.sourceId : undefined);
  const update = useUpdateDiscoveredModel(id ?? "");
  const run = useRunDiscoveredModel(id ?? "");
  const cancel = useCancelAutomationRun();
  const [sheetOpen, setSheetOpen] = useState(false);

  const m = model.data;
  const breadcrumbs = [
    { label: tSidebar("groups.deploymentGate") },
    { label: tSidebar("items.deploymentGateModels"), to: "/deployment-gate" },
    { label: m?.name ?? "…" },
  ];

  return (
    <>
      <PageHeader
        title={m?.name ?? "…"}
        subtitle={m ? `${m.sourceName}${m.clusterId ? ` · #${m.clusterId}` : ""}` : undefined}
        breadcrumbs={breadcrumbs}
        rightSlot={
          m && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setSheetOpen(true)}
                disabled={m.status === "unroutable" || m.status === "removed"}
              >
                <Settings2 className="mr-2 h-4 w-4" />
                {t("detail.editConfig")}
              </Button>
              <Button
                disabled={!m.automationEnabled || run.isPending}
                onClick={async () => {
                  try {
                    await run.mutateAsync();
                    toast.success(t("models.runQueued"));
                  } catch (e) {
                    toast.error(
                      t("models.runFailed", { error: e instanceof Error ? e.message : String(e) }),
                    );
                  }
                }}
              >
                <Play className="mr-2 h-4 w-4" />
                {t("models.runNow")}
              </Button>
            </div>
          )
        }
      />
      <div className="px-8 py-6 space-y-8">
        {m && (
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 text-sm">
            <div>
              <span className="mr-2 text-muted-foreground">{t("models.col.status")}</span>
              <ModelStatusBadge status={m.status} />
            </div>
            <div>
              <span className="mr-2 text-muted-foreground">{t("detail.route")}</span>
              {m.status === "unroutable" ? (
                <Select onValueChange={(v) => update.mutate({ routeName: v })}>
                  <SelectTrigger className="inline-flex w-64">
                    <SelectValue placeholder={t("detail.pickRoute")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(routes.data ?? []).map((r) => (
                      <SelectItem key={r.name} value={r.name}>
                        {r.name} ({r.targets})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="font-mono">
                  {m.routeName}{" "}
                  <span className="text-muted-foreground">
                    ({m.routeOverride ? t("detail.routeManual") : t("detail.routeAuto")})
                  </span>
                </span>
              )}
            </div>
            <div>
              <span className="mr-2 text-muted-foreground">{t("detail.connection")}</span>
              {m.connectionId ? (
                <Link className="hover:underline" to="/connections">
                  {m.routeName}
                </Link>
              ) : (
                "—"
              )}
            </div>
            <div>
              <span className="mr-2 text-muted-foreground">{t("detail.baseline")}</span>
              {m.baselineId ?? (
                <span className="text-muted-foreground">{t("detail.noBaseline")}</span>
              )}
            </div>
            <div>
              <span className="mr-2 text-muted-foreground">{t("detail.schedule")}</span>
              {t(`automation.scheduleOptions.${m.schedule}`)}
              {m.nextScheduledAt && (
                <>
                  {" "}
                  · {t("detail.nextRun")} <RelativeTime date={m.nextScheduledAt} />
                </>
              )}
            </div>
          </section>
        )}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("detail.timeline")}
          </h2>
          <RevisionTimeline
            revisions={revisions.data ?? []}
            onCancelRun={async (rid) => {
              try {
                await cancel.mutateAsync(rid);
              } catch (e) {
                toast.error(
                  t("detail.cancelFailed", { error: e instanceof Error ? e.message : String(e) }),
                );
              }
            }}
          />
        </section>
      </div>
      {m && <AutomationSheet open={sheetOpen} onOpenChange={setSheetOpen} model={m} />}
    </>
  );
}
