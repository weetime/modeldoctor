import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

function CollapseBlock({
  label,
  content,
  defaultOpen = false,
}: {
  label: string;
  content: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <Button variant="ghost" size="sm" onClick={() => setOpen((s) => !s)}>
        {open ? (
          <ChevronDown className="mr-1 h-4 w-4" />
        ) : (
          <ChevronRight className="mr-1 h-4 w-4" />
        )}
        {label}
      </Button>
      {open && (
        <pre className="mt-2 max-h-[400px] overflow-auto rounded-md border border-border bg-muted/30 p-3 text-xs whitespace-pre-wrap break-all">
          {content}
        </pre>
      )}
    </div>
  );
}

export function BenchmarkDetailRawOutput({
  rawOutput,
  logs,
}: {
  rawOutput: Record<string, unknown> | null;
  logs: string | null;
}) {
  const { t } = useTranslation("benchmarks");

  const stdout = (rawOutput?.stdout as string | undefined) ?? "";
  const stderr = (rawOutput?.stderr as string | undefined) ?? "";
  // rawOutput minus stdout/stderr for the raw JSON block
  const rawRest = rawOutput
    ? Object.fromEntries(
        Object.entries(rawOutput).filter(([k]) => k !== "stdout" && k !== "stderr"),
      )
    : null;

  return (
    <div className="space-y-3">
      {stdout.trim() && (
        <CollapseBlock label={t("detail.logs.stdout")} content={stdout} defaultOpen />
      )}
      {stderr.trim() && <CollapseBlock label={t("detail.logs.stderr")} content={stderr} />}
      {logs && <CollapseBlock label={t("detail.logs.toggle")} content={logs} />}
      {rawRest && Object.keys(rawRest).length > 0 && (
        <CollapseBlock
          label={t("detail.rawOutput.toggle")}
          content={JSON.stringify(rawRest, null, 2)}
        />
      )}
    </div>
  );
}
