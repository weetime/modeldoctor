import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api-client";
import { useConnectionsStore } from "@/stores/connections-store";
import type {
  PlaygroundEmbeddingsRequest,
  PlaygroundEmbeddingsResponse,
} from "@modeldoctor/contracts";
import { Trash2 } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CategoryEndpointSelector } from "../CategoryEndpointSelector";
import { PlaygroundShell } from "../PlaygroundShell";
import { genEmbeddingsSnippets } from "../code-snippets/embeddings";
import { HistoryDrawer } from "../history/HistoryDrawer";
import { createHistoryStore } from "../history/createHistoryStore";
import { EmbeddingsParamsPanel } from "./EmbeddingsParams";
import { PcaScatter } from "./PcaScatter";
import { useEmbeddingsStore } from "./store";

interface Snap {
  selectedConnectionId: string | null;
  inputs: string[];
  batchMode: boolean;
  params: { encodingFormat?: "float" | "base64"; dimensions?: number };
}

export const useEmbeddingsHistoryStore = createHistoryStore<Snap>({
  name: "md-playground-history-embeddings",
  blank: () => ({
    selectedConnectionId: null,
    inputs: [""],
    batchMode: false,
    params: {},
  }),
  preview: (s) => s.inputs.find((x) => x.trim().length > 0)?.slice(0, 80) ?? "",
});

export function EmbeddingsPage() {
  const { t } = useTranslation("playground");
  const slice = useEmbeddingsStore();
  const conn = useConnectionsStore((s) =>
    slice.selectedConnectionId ? s.get(slice.selectedConnectionId) : null,
  );
  const canSubmit = !!conn && slice.inputs.some((i) => i.trim().length > 0) && !slice.loading;

  // History sync
  const historyCurrentId = useEmbeddingsHistoryStore((h) => h.currentId);
  useEffect(() => {
    const entry = useEmbeddingsHistoryStore.getState().list.find((e) => e.id === historyCurrentId);
    if (!entry) return;
    const s = useEmbeddingsStore.getState();
    s.reset();
    s.setSelected(entry.snapshot.selectedConnectionId);
    s.setBatchMode(entry.snapshot.batchMode);
    for (let i = 0; i < entry.snapshot.inputs.length; i++) {
      if (i === 0) s.setInputAt(0, entry.snapshot.inputs[0] ?? "");
      else {
        s.addInput();
        s.setInputAt(i, entry.snapshot.inputs[i]);
      }
    }
    s.patchParams(entry.snapshot.params);
  }, [historyCurrentId]);

  useEffect(() => {
    useEmbeddingsHistoryStore.getState().scheduleAutoSave({
      selectedConnectionId: slice.selectedConnectionId,
      inputs: slice.inputs,
      batchMode: slice.batchMode,
      params: slice.params,
    });
  }, [slice.selectedConnectionId, slice.inputs, slice.batchMode, slice.params]);

  const onSubmit = async () => {
    if (!conn) return;
    const inputs = slice.inputs.map((s) => s.trim()).filter((s) => s.length > 0);
    if (inputs.length === 0) return;
    slice.setLoading(true);
    slice.setError(null);
    try {
      const body: PlaygroundEmbeddingsRequest = {
        apiBaseUrl: conn.apiBaseUrl,
        apiKey: conn.apiKey,
        model: conn.model,
        customHeaders: conn.customHeaders || undefined,
        queryParams: conn.queryParams || undefined,
        input: inputs.length === 1 ? inputs[0] : inputs,
        encodingFormat: slice.params.encodingFormat,
        dimensions: slice.params.dimensions,
      };
      const res = await api.post<PlaygroundEmbeddingsResponse>("/api/playground/embeddings", body);
      if (res.success) {
        slice.setResult(res.embeddings ?? []);
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
    ? genEmbeddingsSnippets({
        apiBaseUrl: conn.apiBaseUrl,
        model: conn.model,
        input: slice.inputs.length === 1 ? slice.inputs[0] : slice.inputs,
        encodingFormat: slice.params.encodingFormat,
        dimensions: slice.params.dimensions,
      })
    : null;

  return (
    <PlaygroundShell
      category="embeddings"
      viewCodeSnippets={snippets}
      historySlot={<HistoryDrawer useHistoryStore={useEmbeddingsHistoryStore} />}
      paramsSlot={
        <div className="space-y-4">
          <CategoryEndpointSelector
            category="embeddings"
            selectedConnectionId={slice.selectedConnectionId}
            onSelect={slice.setSelected}
          />
          <EmbeddingsParamsPanel value={slice.params} onChange={slice.patchParams} />
        </div>
      }
    >
      <PageHeader title={t("embeddings.title")} subtitle={t("embeddings.subtitle")} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 py-4">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={slice.batchMode}
                onChange={(e) => slice.setBatchMode(e.target.checked)}
              />
              {t("embeddings.batchMode")}
            </label>
            <div className="flex gap-2">
              {!slice.batchMode ? (
                <Button size="sm" variant="outline" onClick={slice.addInput}>
                  {t("embeddings.addInput")}
                </Button>
              ) : null}
              <Button size="sm" variant="outline" onClick={slice.clearInputs}>
                {t("embeddings.clear")}
              </Button>
            </div>
          </div>
          {slice.batchMode ? (
            <Textarea
              rows={6}
              defaultValue={slice.inputs.join("\n")}
              onChange={(e) => slice.setBatchText(e.target.value)}
              placeholder={t("embeddings.batchPlaceholder")}
              className="font-mono text-xs"
            />
          ) : (
            <div className="space-y-1">
              {slice.inputs.map((v, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: ordered append-only with explicit remove
                <div key={i} className="flex items-center gap-2">
                  <span className="w-6 text-right text-xs text-muted-foreground">{i + 1}</span>
                  <Textarea
                    rows={1}
                    value={v}
                    onChange={(e) => slice.setInputAt(i, e.target.value)}
                    className="text-sm"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => slice.removeInput(i)}
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
            {slice.loading ? t("embeddings.sending") : t("embeddings.send")}
          </Button>
          {slice.error ? (
            <span className="ml-3 text-xs text-destructive">{slice.error}</span>
          ) : null}
        </div>
        <div className="flex-1 overflow-hidden">
          <Tabs defaultValue="chart" className="h-full">
            <TabsList>
              <TabsTrigger value="chart">{t("embeddings.tabs.chart")}</TabsTrigger>
              <TabsTrigger value="json">{t("embeddings.tabs.json")}</TabsTrigger>
            </TabsList>
            <TabsContent value="chart" className="h-[60vh]">
              {slice.result ? (
                <PcaScatter vectors={slice.result} labels={slice.inputs} />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  {t("embeddings.chart.empty")}
                </div>
              )}
            </TabsContent>
            <TabsContent value="json">
              <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 text-[10px]">
                {slice.result ? JSON.stringify(slice.result, null, 2) : ""}
              </pre>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </PlaygroundShell>
  );
}
