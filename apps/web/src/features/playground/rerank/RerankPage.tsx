import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api-client";
import { useConnectionsStore } from "@/stores/connections-store";
import type { PlaygroundRerankRequest, PlaygroundRerankResponse } from "@modeldoctor/contracts";
import { Trash2 } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CategoryEndpointSelector } from "../CategoryEndpointSelector";
import { PlaygroundShell } from "../PlaygroundShell";
import { genRerankSnippets } from "../code-snippets/rerank";
import { HistoryDrawer } from "../history/HistoryDrawer";
import { createHistoryStore } from "../history/createHistoryStore";
import { RerankParamsPanel } from "./RerankParams";
import { type RerankParams as RerankParamsT, useRerankStore } from "./store";

interface Snap {
  selectedConnectionId: string | null;
  query: string;
  documents: string[];
  batchMode: boolean;
  params: RerankParamsT;
}

export const useRerankHistoryStore = createHistoryStore<Snap>({
  name: "md-playground-history-rerank",
  blank: () => ({
    selectedConnectionId: null,
    query: "",
    documents: [""],
    batchMode: false,
    params: { wire: "cohere", topN: 3, returnDocuments: false },
  }),
  preview: (s) => s.query.slice(0, 80),
});

export function RerankPage() {
  const { t } = useTranslation("playground");
  const slice = useRerankStore();
  const conn = useConnectionsStore((s) =>
    slice.selectedConnectionId ? s.get(slice.selectedConnectionId) : null,
  );
  const docs = slice.documents.map((d) => d.trim()).filter((d) => d.length > 0);
  const canSubmit = !!conn && slice.query.trim().length > 0 && docs.length > 0 && !slice.loading;

  const currentId = useRerankHistoryStore((h) => h.currentId);
  useEffect(() => {
    const entry = useRerankHistoryStore.getState().list.find((e) => e.id === currentId);
    if (!entry) return;
    const s = useRerankStore.getState();
    s.reset();
    s.setSelected(entry.snapshot.selectedConnectionId);
    s.setQuery(entry.snapshot.query);
    s.setBatchMode(entry.snapshot.batchMode);
    for (let i = 0; i < entry.snapshot.documents.length; i++) {
      if (i === 0) s.setDocAt(0, entry.snapshot.documents[0] ?? "");
      else {
        s.addDocument();
        s.setDocAt(i, entry.snapshot.documents[i]);
      }
    }
    s.patchParams(entry.snapshot.params);
  }, [currentId]);

  useEffect(() => {
    useRerankHistoryStore.getState().scheduleAutoSave({
      selectedConnectionId: slice.selectedConnectionId,
      query: slice.query,
      documents: slice.documents,
      batchMode: slice.batchMode,
      params: slice.params,
    });
  }, [slice.selectedConnectionId, slice.query, slice.documents, slice.batchMode, slice.params]);

  const onSubmit = async () => {
    if (!conn) return;
    slice.setLoading(true);
    slice.setError(null);
    try {
      const body: PlaygroundRerankRequest = {
        apiBaseUrl: conn.apiBaseUrl,
        apiKey: conn.apiKey,
        model: conn.model,
        customHeaders: conn.customHeaders || undefined,
        queryParams: conn.queryParams || undefined,
        query: slice.query.trim(),
        documents: docs,
        topN: slice.params.topN,
        returnDocuments: slice.params.returnDocuments,
        wire: slice.params.wire,
      };
      const res = await api.post<PlaygroundRerankResponse>("/api/playground/rerank", body);
      if (res.success) {
        slice.setResults(res.results ?? []);
      } else {
        slice.setError(res.error ?? "unknown");
        toast.error(res.error ?? "unknown");
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "network";
      slice.setError(msg);
      toast.error(msg);
    } finally {
      slice.setLoading(false);
    }
  };

  const snippets = conn
    ? genRerankSnippets({
        apiBaseUrl: conn.apiBaseUrl,
        model: conn.model,
        query: slice.query,
        documents: docs,
        topN: slice.params.topN,
        returnDocuments: slice.params.returnDocuments,
        wire: slice.params.wire,
      })
    : null;

  const maxScore = slice.results.length > 0 ? slice.results[0].score : 1;

  return (
    <PlaygroundShell
      category="rerank"
      viewCodeSnippets={snippets}
      historySlot={<HistoryDrawer useHistoryStore={useRerankHistoryStore} />}
      paramsSlot={
        <div className="space-y-4">
          <CategoryEndpointSelector
            category="rerank"
            selectedConnectionId={slice.selectedConnectionId}
            onSelect={slice.setSelected}
          />
          <RerankParamsPanel value={slice.params} onChange={slice.patchParams} />
        </div>
      }
    >
      <PageHeader title={t("rerank.title")} subtitle={t("rerank.subtitle")} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 py-4">
        <div>
          <Label className="text-xs text-muted-foreground">{t("rerank.query")}</Label>
          <Input
            value={slice.query}
            onChange={(e) => slice.setQuery(e.target.value)}
            placeholder={t("rerank.queryPlaceholder")}
            className="text-sm"
          />
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">{t("rerank.documents")}</Label>
            <div className="flex gap-2">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={slice.batchMode}
                  onChange={(e) => slice.setBatchMode(e.target.checked)}
                />
                {t("rerank.batchMode")}
              </label>
              {!slice.batchMode ? (
                <Button size="sm" variant="outline" onClick={slice.addDocument}>
                  {t("rerank.addDoc")}
                </Button>
              ) : null}
            </div>
          </div>
          {slice.batchMode ? (
            <Textarea
              rows={6}
              defaultValue={slice.documents.join("\n")}
              onChange={(e) => slice.setBatchText(e.target.value)}
              placeholder={t("rerank.batchPlaceholder")}
              className="font-mono text-xs"
            />
          ) : (
            <div className="space-y-1">
              {slice.documents.map((d, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: ordered append-only with explicit remove
                <div key={i} className="flex items-center gap-2">
                  <span className="w-6 text-right text-xs text-muted-foreground">{i + 1}</span>
                  <Textarea
                    rows={1}
                    value={d}
                    onChange={(e) => slice.setDocAt(i, e.target.value)}
                    className="text-sm"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => slice.removeDocument(i)}
                    aria-label="remove"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <Button onClick={onSubmit} disabled={!canSubmit}>
            {slice.loading ? t("rerank.sending") : t("rerank.send")}
          </Button>
          {slice.error ? (
            <span className="ml-3 text-xs text-destructive">{slice.error}</span>
          ) : null}
        </div>
        <div className="space-y-2">
          {slice.results.map((r) => (
            <div
              key={r.index}
              className="flex items-center gap-3 rounded-md border border-border p-2"
            >
              <span className="w-8 text-right text-xs text-muted-foreground">#{r.index + 1}</span>
              <div className="flex-1">
                <div className="text-sm">{slice.documents[r.index] ?? ""}</div>
                <Progress value={(r.score / (maxScore || 1)) * 100} className="mt-1 h-1.5" />
              </div>
              <span className="font-mono text-xs">{r.score.toFixed(3)}</span>
            </div>
          ))}
        </div>
      </div>
    </PlaygroundShell>
  );
}
