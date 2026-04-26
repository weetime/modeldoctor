import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { BenchmarkActionsCell } from "./BenchmarkActionsCell";
import { BenchmarkCreateModal } from "./BenchmarkCreateModal";
import {
  benchmarkKeys,
  useBenchmarkList,
  useCancelBenchmark,
  useDeleteBenchmark,
} from "./queries";
import type {
  BenchmarkProfile,
  BenchmarkState,
} from "@modeldoctor/contracts";
import { Activity } from "lucide-react";

const PROFILES: BenchmarkProfile[] = [
  "throughput",
  "latency",
  "long_context",
  "generation_heavy",
  "sharegpt",
  "custom",
];
const STATES: BenchmarkState[] = [
  "pending",
  "submitted",
  "running",
  "completed",
  "failed",
  "canceled",
];

const ALL = "__all__";

function fmtMs(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n.toFixed(1)} ms`;
}
function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toFixed(1);
}

function profileLabel(p: BenchmarkProfile): string {
  if (p === "long_context") return "longContext";
  if (p === "generation_heavy") return "generationHeavy";
  if (p === "sharegpt") return "shareGpt";
  return p;
}

export function BenchmarkListPage() {
  const { t } = useTranslation("benchmark");
  const [, setSearchParams] = useSearchParams();
  const qc = useQueryClient();

  const [stateFilter, setStateFilter] = useState<BenchmarkState | undefined>();
  const [profileFilter, setProfileFilter] =
    useState<BenchmarkProfile | undefined>();
  const [search, setSearch] = useState("");
  const [pendingCancel, setPendingCancel] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const query = useMemo(
    () => ({
      limit: 20,
      state: stateFilter,
      profile: profileFilter,
      search: search.trim() || undefined,
    }),
    [stateFilter, profileFilter, search],
  );

  const { data, isLoading, isError, error, refetch } = useBenchmarkList(query);
  const cancelMut = useCancelBenchmark();
  const deleteMut = useDeleteBenchmark();

  const isFiltered =
    stateFilter !== undefined ||
    profileFilter !== undefined ||
    search.trim() !== "";

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        rightSlot={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                qc.invalidateQueries({ queryKey: benchmarkKeys.lists() })
              }
            >
              {t("actions.refresh")}
            </Button>
            <Button
              size="sm"
              onClick={() => setSearchParams({ create: "1" })}
            >
              {t("actions.create")}
            </Button>
          </div>
        }
      />

      <div className="space-y-4 px-8 py-6">
        <div className="flex flex-wrap gap-2">
          <Select
            value={stateFilter ?? ALL}
            onValueChange={(v) =>
              setStateFilter(v === ALL ? undefined : (v as BenchmarkState))
            }
          >
            <SelectTrigger
              className="w-[180px]"
              aria-label={t("list.filters.state")}
            >
              <SelectValue placeholder={t("list.filters.state")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("list.filters.state")}</SelectItem>
              {STATES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`detail.states.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={profileFilter ?? ALL}
            onValueChange={(v) =>
              setProfileFilter(v === ALL ? undefined : (v as BenchmarkProfile))
            }
          >
            <SelectTrigger
              className="w-[180px]"
              aria-label={t("list.filters.profile")}
            >
              <SelectValue placeholder={t("list.filters.profile")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("list.filters.profile")}</SelectItem>
              {PROFILES.map((p) => (
                <SelectItem key={p} value={p}>
                  {t(`profiles.${profileLabel(p)}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            placeholder={t("list.filters.search")}
            className="w-[240px]"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {isFiltered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setStateFilter(undefined);
                setProfileFilter(undefined);
                setSearch("");
              }}
            >
              {t("actions.clearFilters")}
            </Button>
          )}
        </div>

        {isError ? (
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between">
              <span>{(error as Error).message}</span>
              <Button size="sm" variant="outline" onClick={() => refetch()}>
                {t("actions.retry")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : isLoading ? (
          <div
            role="status"
            aria-label="loading"
            className="h-64 animate-pulse rounded-md border border-border bg-muted/30"
          />
        ) : data && data.items.length === 0 ? (
          isFiltered ? (
            <Alert>
              <AlertDescription>{t("list.empty.filtered")}</AlertDescription>
            </Alert>
          ) : (
            <EmptyState
              icon={Activity}
              title={t("list.empty.title")}
              body={t("list.empty.description")}
            />
          )
        ) : (
          <>
            <div className="rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("list.columns.name")}</TableHead>
                    <TableHead>{t("list.columns.model")}</TableHead>
                    <TableHead>{t("list.columns.profile")}</TableHead>
                    <TableHead>{t("list.columns.state")}</TableHead>
                    <TableHead className="text-right">
                      {t("list.columns.outputTps")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("list.columns.ttftMean")}
                    </TableHead>
                    <TableHead>{t("list.columns.createdAt")}</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.items.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell>
                        <Link
                          to={`/benchmarks/${run.id}`}
                          className="text-foreground hover:underline"
                        >
                          {run.name}
                        </Link>
                      </TableCell>
                      <TableCell>{run.model}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {t(`profiles.${profileLabel(run.profile)}`)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <BenchmarkStateBadge state={run.state} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNum(run.metricsSummary?.outputTokensPerSecond.mean)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtMs(run.metricsSummary?.ttft.mean)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDistanceToNow(new Date(run.createdAt), {
                          addSuffix: true,
                        })}
                      </TableCell>
                      <TableCell>
                        <BenchmarkActionsCell
                          run={run}
                          onCancel={(id) => setPendingCancel(id)}
                          onDelete={(id) => setPendingDelete(id)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {data?.nextCursor && (
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    /* Phase 6: append next page; spec §1.2 keeps it explicit */
                  }}
                  disabled
                >
                  {t("actions.loadMore")}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <BenchmarkCreateModal />

      {/* Cancel confirmation */}
      <AlertDialog
        open={pendingCancel !== null}
        onOpenChange={(open) => !open && setPendingCancel(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("actions.cancel")}?</AlertDialogTitle>
            <AlertDialogDescription>
              In-flight requests will be terminated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingCancel) cancelMut.mutate(pendingCancel);
                setPendingCancel(null);
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("actions.delete")}?</AlertDialogTitle>
            <AlertDialogDescription>
              Metrics and logs will be lost permanently.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => {
                if (pendingDelete) deleteMut.mutate(pendingDelete);
                setPendingDelete(null);
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
