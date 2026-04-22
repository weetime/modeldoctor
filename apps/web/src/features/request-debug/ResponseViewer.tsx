import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DebugResponse } from "./types";

interface Props {
  response: DebugResponse | null;
  error: string | null;
}

function statusColor(status: number): string {
  if (status >= 500) return "text-destructive";
  if (status >= 400) return "text-warning";
  if (status >= 200 && status < 300) return "text-success";
  return "text-foreground";
}

function BinaryDownload({ base64, contentType }: { base64: string; contentType: string }) {
  const { t } = useTranslation("debug");
  const onDownload = () => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], {
      type: contentType || "application/octet-stream",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "response.bin";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Button variant="outline" size="sm" onClick={onDownload}>
      <Download className="h-3 w-3" />
      <span className="ml-1">{t("response.download")}</span>
    </Button>
  );
}

function renderBody(response: DebugResponse) {
  const ct = response.headers["content-type"] || "";
  if (response.bodyEncoding === "base64") {
    if (ct.startsWith("image/")) {
      return (
        <img
          alt="response"
          src={`data:${ct};base64,${response.body}`}
          className="max-w-full rounded-md border border-border"
        />
      );
    }
    if (ct.startsWith("audio/")) {
      return (
        // biome-ignore lint/a11y/useMediaCaption: debug viewer for arbitrary audio
        <audio controls src={`data:${ct};base64,${response.body}`} className="w-full" />
      );
    }
    return <BinaryDownload base64={response.body} contentType={ct} />;
  }
  // text
  let text = response.body;
  if (ct.includes("application/json")) {
    try {
      text = JSON.stringify(JSON.parse(response.body), null, 2);
    } catch {
      /* leave as-is */
    }
  }
  return (
    <pre className="max-h-[480px] overflow-auto rounded-md bg-muted/40 p-3 font-mono text-xs">
      {text}
    </pre>
  );
}

export function ResponseViewer({ response, error }: Props) {
  const { t } = useTranslation("debug");
  if (error) {
    return (
      <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
        {error}
      </div>
    );
  }
  if (!response) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className={statusColor(response.status)}>
          {t("response.status")}:{" "}
          <span className="font-mono">
            {response.status} {response.statusText}
          </span>
        </span>
        <span className="text-muted-foreground">
          {t("response.size")}: <span className="font-mono">{response.sizeBytes}</span> B
        </span>
        <span className="text-muted-foreground">
          {t("response.ttfb")}: <span className="font-mono">{response.timingMs.ttfbMs}</span> ms
        </span>
        <span className="text-muted-foreground">
          {t("response.total")}: <span className="font-mono">{response.timingMs.totalMs}</span> ms
        </span>
      </div>

      <Tabs defaultValue="body">
        <TabsList>
          <TabsTrigger value="body">{t("response.tabs.body")}</TabsTrigger>
          <TabsTrigger value="headers">{t("response.tabs.headers")}</TabsTrigger>
          <TabsTrigger value="timing">{t("response.tabs.timing")}</TabsTrigger>
          <TabsTrigger value="raw">{t("response.tabs.raw")}</TabsTrigger>
        </TabsList>
        <TabsContent value="body">{renderBody(response)}</TabsContent>
        <TabsContent value="headers">
          <table className="w-full text-xs">
            <tbody>
              {Object.entries(response.headers).map(([k, v]) => (
                <tr key={k} className="border-b border-border">
                  <td className="py-1 pr-3 font-mono text-muted-foreground">{k}</td>
                  <td className="py-1 font-mono">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TabsContent>
        <TabsContent value="timing">
          <div className="space-y-1 text-sm">
            <div>
              TTFB: <span className="font-mono">{response.timingMs.ttfbMs} ms</span>
            </div>
            <div>
              Total: <span className="font-mono">{response.timingMs.totalMs} ms</span>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="raw">
          <pre className="max-h-[480px] overflow-auto rounded-md bg-muted/40 p-3 font-mono text-xs">
            {response.body}
          </pre>
        </TabsContent>
      </Tabs>
    </div>
  );
}
