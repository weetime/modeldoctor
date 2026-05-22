import { Check, RotateCcw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ProbeName, ProbeResult } from "./types";
import { PROBE_DEFAULT_PATHS } from "./types";

interface Props {
  name: ProbeName;
  result: ProbeResult | null;
  running: boolean;
  /** Effective path = override if set, else default. */
  pathOverride: string | undefined;
  onPathChange: (next: string) => void;
  onPathReset: () => void;
  onRun: () => void;
  disabledReason?: string;
}

export function ProbeCard({
  name,
  result,
  running,
  pathOverride,
  onPathChange,
  onPathReset,
  onRun,
  disabledReason,
}: Props) {
  const { t } = useTranslation("diagnostics");
  const { t: tc } = useTranslation("common");
  const variant: "default" | "warning" | "success" | "destructive" = running
    ? "warning"
    : result === null
      ? "default"
      : result.pass
        ? "success"
        : "destructive";
  const status = running
    ? tc("status.running")
    : result === null
      ? tc("status.idle")
      : result.pass
        ? tc("status.pass")
        : tc("status.fail");

  const defaultPath = PROBE_DEFAULT_PATHS[name];
  const effectivePath = pathOverride ?? defaultPath;
  const isOverridden = pathOverride !== undefined && pathOverride !== defaultPath;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-card p-4",
        result?.pass && "border-l-2 border-l-success",
        result && !result.pass && "border-l-2 border-l-destructive",
        running && "border-l-2 border-l-warning",
      )}
    >
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">{t(`probes.${name}.title`)}</h3>
          <p className="font-mono text-[10px] text-muted-foreground">
            {t(`probes.${name}.subtitle`)}
          </p>
        </div>
        <Badge variant={variant}>{status}</Badge>
      </div>

      <div className="flex items-center gap-1">
        <Input
          value={effectivePath}
          onChange={(e) => onPathChange(e.target.value)}
          className={cn("h-7 font-mono text-[11px]", !isOverridden && "text-muted-foreground")}
          placeholder={defaultPath}
        />
        {isOverridden ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onPathReset}
            title={t("path.resetToDefault")}
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
        ) : null}
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={onRun}
        disabled={running || !!disabledReason}
        title={disabledReason}
      >
        {tc("actions.run")}
      </Button>

      {result ? <ProbeResultDetails result={result} /> : null}
    </div>
  );
}

// `details` is `Record<string, unknown>` per the contract; we know the
// per-probe shape from the runner. Narrow it locally so the JSX stays
// readable while keeping the contract permissive.
interface DiagnosticsDetails {
  content?: string;
  imagePreviewB64?: string;
  imageMime?: string;
  audioB64?: string;
  imageGenUrl?: string;
  imageGenB64?: string;
  embeddingDims?: number;
  embeddingSample?: number[];
  rerankResults?: Array<{ index: number; score: number }>;
  error?: string;
}

function ProbeResultDetails({ result }: { result: ProbeResult }) {
  const { t } = useTranslation("diagnostics");
  const details = (result.details ?? {}) as DiagnosticsDetails;

  return (
    <div className="space-y-2 text-xs">
      <p className="text-muted-foreground">{t("meta.latency", { ms: result.latencyMs ?? "—" })}</p>
      <ul className="space-y-1 font-mono">
        {result.checks.map((c) => (
          <li key={c.name} className="flex items-start gap-1">
            {c.pass ? (
              <Check className="mt-0.5 h-3 w-3 text-success" />
            ) : (
              <X className="mt-0.5 h-3 w-3 text-destructive" />
            )}
            <span>{c.name}</span>
            {c.info ? <span className="text-muted-foreground">({c.info})</span> : null}
          </li>
        ))}
      </ul>
      {details.content ? (
        <div className="rounded-md bg-muted/40 px-2 py-1 text-foreground">{details.content}</div>
      ) : null}
      {details.imagePreviewB64 ? (
        <img
          alt="probe input"
          src={`data:${details.imageMime ?? "image/png"};base64,${details.imagePreviewB64}`}
          className="max-w-[120px] rounded-md border border-border"
        />
      ) : null}
      {details.audioB64 ? (
        // biome-ignore lint/a11y/useMediaCaption: audio probe output has no transcript
        <audio controls src={`data:audio/wav;base64,${details.audioB64}`} className="w-full" />
      ) : null}
      {details.imageGenUrl ? (
        <img
          alt="generated"
          src={details.imageGenUrl}
          className="max-w-[200px] rounded-md border border-border"
        />
      ) : null}
      {details.imageGenB64 ? (
        <img
          alt="generated"
          src={`data:image/png;base64,${details.imageGenB64}`}
          className="max-w-[200px] rounded-md border border-border"
        />
      ) : null}
      {details.embeddingDims !== undefined ? (
        <div className="rounded-md bg-muted/40 px-2 py-1 font-mono text-[11px]">
          {t("meta.embeddingDims", { dims: details.embeddingDims })}
          {details.embeddingSample
            ? `: [${details.embeddingSample.map((n) => n.toFixed(3)).join(", ")}, …]`
            : ""}
        </div>
      ) : null}
      {details.rerankResults ? (
        <ol className="rounded-md bg-muted/40 px-2 py-1 font-mono text-[11px]">
          {details.rerankResults.map((r) => (
            <li key={r.index}>
              #{r.index} → {r.score.toFixed(3)}
            </li>
          ))}
        </ol>
      ) : null}
      {details.error ? (
        <div className="rounded-md bg-destructive/10 px-2 py-1 font-mono text-[11px] text-destructive">
          {details.error}
        </div>
      ) : null}
    </div>
  );
}
