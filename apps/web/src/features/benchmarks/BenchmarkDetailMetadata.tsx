import type { Benchmark } from "@modeldoctor/contracts";
import { format, formatDistanceStrict } from "date-fns";
import { Copy } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { copyToClipboard } from "@/lib/clipboard";
import { StatusBadge } from "./status-display";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return format(new Date(iso), "yyyy-MM-dd HH:mm:ss");
}

function fmtDuration(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  return formatDistanceStrict(new Date(end), new Date(start));
}

export function BenchmarkDetailMetadata({ benchmark }: { benchmark: Benchmark }) {
  const { t } = useTranslation("benchmarks");
  return (
    <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
      <Row label={t("detail.metadata.scenario")}>{benchmark.scenario}</Row>
      <Row label={t("detail.metadata.tool")}>{benchmark.tool}</Row>
      <Row label={t("detail.metadata.status")}>
        <StatusBadge status={benchmark.status} />
      </Row>
      <Row label={t("detail.metadata.connection")}>
        {benchmark.connection ? (
          <div className="flex flex-col">
            <span>{benchmark.connection.model}</span>
            <span className="text-xs font-normal text-muted-foreground">
              {benchmark.connection.name} · {benchmark.connection.baseUrl}
            </span>
          </div>
        ) : (
          t("detail.metadata.connectionMissing")
        )}
      </Row>
      <Row label={t("detail.metadata.createdAt")}>{fmtDate(benchmark.createdAt)}</Row>
      <Row label={t("detail.metadata.startedAt")}>{fmtDate(benchmark.startedAt)}</Row>
      <Row label={t("detail.metadata.completedAt")}>{fmtDate(benchmark.completedAt)}</Row>
      <Row label={t("detail.metadata.duration")}>
        {fmtDuration(benchmark.startedAt, benchmark.completedAt)}
      </Row>
      {benchmark.driverHandle && <JobRow handle={benchmark.driverHandle} />}
    </dl>
  );
}

/** Surfaces the K8s job that ran this benchmark so operators can pull pod logs
 *  directly (`driverHandle` is "<namespace>/<jobName>"). The copy button yields
 *  a ready-to-run `kubectl logs` command. */
function JobRow({ handle }: { handle: string }) {
  const { t } = useTranslation("benchmarks");
  const slash = handle.indexOf("/");
  const namespace = slash >= 0 ? handle.slice(0, slash) : null;
  const jobName = slash >= 0 ? handle.slice(slash + 1) : handle;
  const kubectlCmd = namespace
    ? `kubectl logs -n ${namespace} job/${jobName}`
    : `kubectl logs job/${jobName}`;
  return (
    <Row label={t("detail.metadata.job")}>
      <div className="flex flex-col">
        <span className="flex items-center gap-1.5">
          <code className="font-mono text-xs break-all">{jobName}</code>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0"
            title={kubectlCmd}
            onClick={() => {
              void copyToClipboard(kubectlCmd).then((ok) => {
                toast[ok ? "success" : "error"](
                  t(ok ? "detail.metadata.jobCopied" : "detail.metadata.jobCopyFailed"),
                );
              });
            }}
          >
            <Copy className="h-3 w-3" />
          </Button>
        </span>
        {namespace && (
          <span className="text-xs font-normal text-muted-foreground">{namespace}</span>
        )}
      </div>
    </Row>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
