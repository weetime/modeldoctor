import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, Link } from "react-router-dom";
import { format, formatDistanceStrict } from "date-fns";
import { ArrowLeft, SearchX } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BenchmarkStateBadge } from "./BenchmarkStateBadge";
import { BenchmarkMetricsGrid } from "./BenchmarkMetricsGrid";
import { BenchmarkLogsPanel } from "./BenchmarkLogsPanel";
import {
  TERMINAL_STATES,
  useBenchmarkDetail,
  useCancelBenchmark,
  useDeleteBenchmark,
} from "./queries";
import { profileLabelKey } from "./profiles";

export function BenchmarkDetailPage() {
  const { t } = useTranslation("benchmark");
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, isError, error, refetch } = useBenchmarkDetail(
    id ?? "",
  );
  const cancelMut = useCancelBenchmark();
  const deleteMut = useDeleteBenchmark();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!id) {
    return (
      <>
        <PageHeader title={t("detail.errors.notFound")} />
        <div className="px-8 py-6">
          <EmptyState icon={SearchX} title={t("detail.errors.notFound")} />
        </div>
      </>
    );
  }

  if (isLoading) {
    return (
      <>
        <PageHeader title="…" />
        <div className="space-y-4 px-8 py-6">
          <div
            role="status"
            aria-label="loading"
            className="h-24 animate-pulse rounded-md border border-border bg-muted/30"
          />
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-md border border-border bg-muted/30"
              />
            ))}
          </div>
        </div>
      </>
    );
  }

  if (isError || !data) {
    const err = error as Error & { status?: number };
    if (err?.status === 404) {
      return (
        <>
          <PageHeader title={t("detail.errors.notFound")} />
          <div className="px-8 py-6">
            <EmptyState
              icon={SearchX}
              title={t("detail.errors.notFound")}
              actions={
                <Link to="/benchmarks" className="text-sm underline">
                  ← Back to list
                </Link>
              }
            />
          </div>
        </>
      );
    }
    return (
      <>
        <PageHeader title={t("detail.errors.loadFailed")} />
        <div className="px-8 py-6">
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between">
              <span>{err?.message ?? "Unknown error"}</span>
              <Button size="sm" variant="outline" onClick={() => refetch()}>
                {t("actions.retry")}
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      </>
    );
  }

  const isTerminal = (TERMINAL_STATES as readonly string[]).includes(
    data.state,
  );
  const duration =
    data.startedAt && (data.completedAt ?? null)
      ? formatDistanceStrict(
          new Date(data.startedAt),
          new Date(data.completedAt ?? Date.now()),
        )
      : null;

  return (
    <>
      <PageHeader
        title={data.name}
        subtitle={`${t(`profiles.${profileLabelKey(data.profile)}`)}`}
        rightSlot={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/benchmarks")}
            >
              <ArrowLeft className="mr-1 size-4" />
              List
            </Button>
            {!isTerminal && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setConfirmCancel(true)}
              >
                {t("actions.cancel")}
              </Button>
            )}
            {isTerminal && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    navigate(`/benchmarks?duplicate=${data.id}`)
                  }
                >
                  {t("actions.duplicate")}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setConfirmDelete(true)}
                >
                  {t("actions.delete")}
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="space-y-4 px-8 py-6">
        <div className="flex items-center gap-3">
          <BenchmarkStateBadge state={data.state} />
          {duration && (
            <span className="text-xs text-muted-foreground">{duration}</span>
          )}
          {data.startedAt && (
            <span className="text-xs text-muted-foreground">
              {format(new Date(data.startedAt), "yyyy-MM-dd HH:mm")}
              {data.completedAt
                ? ` → ${format(new Date(data.completedAt), "HH:mm")}`
                : ""}
            </span>
          )}
        </div>

        {data.state === "failed" && data.stateMessage && (
          <Alert variant="destructive">
            <AlertDescription>
              <strong>{t("detail.errors.runFailed")}:</strong> {data.stateMessage}
            </AlertDescription>
          </Alert>
        )}
        {data.state === "canceled" && (
          <Alert>
            <AlertDescription>Run was canceled.</AlertDescription>
          </Alert>
        )}
        {!isTerminal && (
          <Progress
            value={data.progress != null ? data.progress * 100 : undefined}
            className="h-1"
          />
        )}

        <div className="grid grid-cols-4 gap-x-6 gap-y-2 rounded-md border border-border bg-muted/30 p-4">
          <KV label={t("detail.config.target")} value={data.apiUrl} />
          <KV label={t("detail.config.model")} value={data.model} />
          <KV label={t("detail.config.apiType")} value={data.apiType} />
          <KV
            label={t("detail.config.dataset")}
            value={
              data.datasetName === "random"
                ? `random · ${data.datasetInputTokens ?? "?"}/${
                    data.datasetOutputTokens ?? "?"
                  } tok`
                : "ShareGPT"
            }
          />
          <KV
            label={t("detail.config.rate")}
            value={
              data.requestRate === 0 ? "unlimited" : `${data.requestRate}/s`
            }
          />
          <KV
            label={t("detail.config.totalRequests")}
            value={String(data.totalRequests)}
          />
          <KV
            label={t("detail.config.success")}
            value={
              data.metricsSummary
                ? `${data.metricsSummary.requests.success} / ${data.metricsSummary.requests.total}`
                : "—"
            }
          />
          <KV
            label={t("detail.config.errors")}
            value={
              data.metricsSummary
                ? String(data.metricsSummary.requests.error)
                : "—"
            }
          />
        </div>

        <BenchmarkMetricsGrid summary={data.metricsSummary} />

        <BenchmarkLogsPanel logs={data.logs} state={data.state} />
      </div>

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("actions.cancel")}?</AlertDialogTitle>
            <AlertDialogDescription>
              In-flight requests will be terminated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                cancelMut.mutate(data.id);
                setConfirmCancel(false);
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("actions.delete")}?</AlertDialogTitle>
            <AlertDialogDescription>
              Metrics and logs will be lost permanently.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => {
                deleteMut.mutate(data.id, {
                  onSuccess: () => navigate("/benchmarks"),
                });
                setConfirmDelete(false);
              }}
            >
              {t("actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}
