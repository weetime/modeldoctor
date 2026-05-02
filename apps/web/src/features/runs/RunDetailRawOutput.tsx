import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export function RunDetailRawOutput({
  rawOutput,
  logs,
}: {
  rawOutput: Record<string, unknown> | null;
  logs: string | null;
}) {
  const { t } = useTranslation("runs");
  const [showRaw, setShowRaw] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  return (
    <div className="space-y-3">
      {rawOutput && Object.keys(rawOutput).length > 0 && (
        <div>
          <Button variant="ghost" size="sm" onClick={() => setShowRaw((s) => !s)}>
            {showRaw ? (
              <ChevronDown className="mr-1 h-4 w-4" />
            ) : (
              <ChevronRight className="mr-1 h-4 w-4" />
            )}{" "}
            {t("detail.rawOutput.toggle")}
          </Button>
          {showRaw && (
            <pre className="mt-2 max-h-[400px] overflow-auto rounded-md border border-border bg-muted/30 p-3 text-xs">
              {JSON.stringify(rawOutput, null, 2)}
            </pre>
          )}
        </div>
      )}
      {logs && (
        <div>
          <Button variant="ghost" size="sm" onClick={() => setShowLogs((s) => !s)}>
            {showLogs ? (
              <ChevronDown className="mr-1 h-4 w-4" />
            ) : (
              <ChevronRight className="mr-1 h-4 w-4" />
            )}{" "}
            {t("detail.logs.toggle")}
          </Button>
          {showLogs && (
            <pre className="mt-2 max-h-[400px] overflow-auto rounded-md border border-border bg-muted/30 p-3 text-xs">
              {logs}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
