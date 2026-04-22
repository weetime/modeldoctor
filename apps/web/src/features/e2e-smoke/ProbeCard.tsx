import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ProbeName, ProbeResult } from "./types";

interface Props {
  name: ProbeName;
  result: ProbeResult | null;
  running: boolean;
  onRun: () => void;
  /** When set, the Run button is disabled and this string is shown as tooltip. */
  disabledReason?: string;
}

export function ProbeCard({ name, result, running, onRun, disabledReason }: Props) {
  const { t } = useTranslation("e2e");
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
          <p className="font-mono text-[10px] text-muted-foreground">{t(`probes.${name}.path`)}</p>
        </div>
        <Badge variant={variant}>{status}</Badge>
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

      {result ? (
        <div className="space-y-2 text-xs">
          <p className="text-muted-foreground">
            {t("meta.latency", { ms: result.latencyMs ?? "—" })}
          </p>
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
          {result.details.content ? (
            <div className="rounded-md bg-muted/40 px-2 py-1 text-foreground">
              {result.details.content}
            </div>
          ) : null}
          {result.details.imagePreviewB64 ? (
            <img
              alt="probe input"
              src={`data:${result.details.imageMime ?? "image/png"};base64,${result.details.imagePreviewB64}`}
              className="max-w-[120px] rounded-md border border-border"
            />
          ) : null}
          {result.details.audioB64 ? (
            // biome-ignore lint/a11y/useMediaCaption: audio probe output has no transcript
            <audio
              controls
              src={`data:audio/wav;base64,${result.details.audioB64}`}
              className="w-full"
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
