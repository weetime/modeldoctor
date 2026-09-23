import type { DiscoveredModelPublic } from "@modeldoctor/contracts";
import { ArrowRight, Play, ShieldHalf } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useDiscoveredModels,
  useRunDiscoveredModel,
  useSources,
  useUpdateDiscoveredModel,
} from "./queries";
import { ModelStatusBadge, VerdictBadge } from "./VerdictBadge";

function ModelRow({ model }: { model: DiscoveredModelPublic }) {
  const { t } = useTranslation("deployment-gate");
  const { t: tCommon } = useTranslation("common");
  const nav = useNavigate();
  const update = useUpdateDiscoveredModel(model.id);
  const run = useRunDiscoveredModel(model.id);

  const automationLocked = model.status === "unroutable" || model.status === "removed";

  async function handleToggle(enabled: boolean) {
    try {
      await update.mutateAsync({ automationEnabled: enabled });
    } catch {
      toast.error(t("models.enableNeedsConfig"));
      nav(`/deployment-gate/models/${model.id}`);
    }
  }

  async function handleRun() {
    try {
      await run.mutateAsync();
      toast.success(t("models.runQueued"));
    } catch (e) {
      toast.error(t("models.runFailed", { error: e instanceof Error ? e.message : String(e) }));
      nav(`/deployment-gate/models/${model.id}`);
    }
  }

  return (
    <TableRow>
      <TableCell className="font-medium">
        <Link
          className="hover:text-primary hover:underline"
          to={`/deployment-gate/models/${model.id}`}
        >
          {model.name}
        </Link>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {model.sourceName}
        {model.clusterId ? ` · #${model.clusterId}` : ""}
      </TableCell>
      <TableCell>
        <ModelStatusBadge status={model.status} />
      </TableCell>
      <TableCell className="font-mono text-xs">
        {model.currentRevision
          ? `${model.currentRevision.backend ?? "?"} ${model.currentRevision.backendVersion ?? ""}`.trim()
          : "—"}
      </TableCell>
      <TableCell>
        <VerdictBadge run={model.lastRun} />
      </TableCell>
      <TableCell>
        <Switch
          checked={model.automationEnabled}
          disabled={automationLocked || update.isPending}
          title={automationLocked ? t(`models.status.${model.status}`) : undefined}
          aria-label={t("models.col.automation")}
          onCheckedChange={handleToggle}
        />
      </TableCell>
      <TableCell className="text-center">
        <div className="inline-flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={tCommon("actions.detail")}
            title={tCommon("actions.detail")}
            asChild
          >
            <Link to={`/deployment-gate/models/${model.id}`}>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("models.runNow")}
            title={t("models.runNow")}
            disabled={!model.automationEnabled || run.isPending}
            onClick={handleRun}
          >
            <Play className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function DeploymentGatePage() {
  const { t } = useTranslation("deployment-gate");
  const { t: tCommon } = useTranslation("common");
  const { data, isLoading } = useDiscoveredModels();
  const sources = useSources();

  return (
    <>
      <PageHeader title={t("models.title")} subtitle={t("models.subtitle")} />
      <div className="px-8 py-6 space-y-6">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">{tCommon("table.loading")}</div>
        ) : !data?.length ? (
          <EmptyState
            icon={ShieldHalf}
            title={t("models.empty.title")}
            body={t("models.empty.body")}
            actions={
              !sources.data?.length ? (
                <Button asChild>
                  <Link to="/deployment-gate/sources">{t("models.empty.action")}</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="rounded-md border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("models.col.name")}</TableHead>
                  <TableHead>{t("models.col.source")}</TableHead>
                  <TableHead>{t("models.col.status")}</TableHead>
                  <TableHead>{t("models.col.revision")}</TableHead>
                  <TableHead>{t("models.col.lastVerdict")}</TableHead>
                  <TableHead>{t("models.col.automation")}</TableHead>
                  <TableHead className="w-40 text-center">{tCommon("table.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((m) => (
                  <ModelRow key={m.id} model={m} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </>
  );
}
