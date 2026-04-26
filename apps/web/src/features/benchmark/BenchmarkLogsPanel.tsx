import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { BenchmarkState } from "@modeldoctor/contracts";
import { TERMINAL_STATES } from "./queries";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function BenchmarkLogsPanel({
  logs,
  state,
}: {
  logs: string | null | undefined;
  state: BenchmarkState;
}) {
  const { t } = useTranslation("benchmark");
  const preRef = useRef<HTMLPreElement>(null);
  const isTerminal = (TERMINAL_STATES as readonly string[]).includes(state);

  useEffect(() => {
    if (preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [logs]);

  if (!logs) {
    return (
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        {isTerminal ? "No logs available." : t("detail.logs.pendingMessage")}
      </div>
    );
  }

  const size = new TextEncoder().encode(logs).length;

  return (
    <details
      className="rounded-md border border-border"
      open={isTerminal}
      role="region"
      aria-label={t("detail.logs.title")}
    >
      <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground select-none">
        ▾ {t("detail.logs.title")}{" "}
        <span className="ml-1">({formatSize(size)})</span>
      </summary>
      <pre
        ref={preRef}
        className="m-0 max-h-[300px] overflow-auto rounded-b-md bg-zinc-900 p-3 text-[11px] text-zinc-200"
      >
        {logs}
      </pre>
    </details>
  );
}
