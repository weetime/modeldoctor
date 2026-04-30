import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api-client";
import { useConnectionsStore } from "@/stores/connections-store";
import type { PlaygroundImagesRequest, PlaygroundImagesResponse } from "@modeldoctor/contracts";
import { Dice5, Download } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { CategoryEndpointSelector } from "../CategoryEndpointSelector";
import { PlaygroundShell } from "../PlaygroundShell";
import { PromptComposer } from "../_shared/PromptComposer";
import { consumeDemoSeed } from "../_shared/demo-seed";
import { genImagesSnippets } from "../code-snippets/images";
import { HistoryDrawer } from "../history/HistoryDrawer";
import { createHistoryStore } from "../history/createHistoryStore";
import { ImageParamsPanel } from "./ImageParams";
import { InpaintMode } from "./InpaintMode";
import { type ImageParams as ImageParamsT, useImageStore } from "./store";

interface Snap {
  selectedConnectionId: string | null;
  prompt: string;
  params: ImageParamsT;
}

export const useImageHistoryStore = createHistoryStore<Snap>({
  name: "md-playground-history-image",
  blank: () => ({
    selectedConnectionId: null,
    prompt: "",
    params: { size: "512x512", n: 1, randomSeedEachRequest: true },
  }),
  preview: (s) => s.prompt.slice(0, 80),
});

type Mode = "generate" | "edit";

export function ImagePage() {
  const { t } = useTranslation("playground");
  const slice = useImageStore();
  const conn = useConnectionsStore((s) =>
    slice.selectedConnectionId ? s.get(slice.selectedConnectionId) : null,
  );
  const canSubmit = !!conn && slice.prompt.trim().length > 0 && !slice.loading;

  const [searchParams, setSearchParams] = useSearchParams();
  const mode: Mode = searchParams.get("mode") === "edit" ? "edit" : "generate";

  // History sync (generate mode only — inpaint state isn't persisted by design)
  const currentId = useImageHistoryStore((h) => h.currentId);
  const restoreVersion = useImageHistoryStore((h) => h.restoreVersion);
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are intentional — restoreVersion handles in-place snapshot replacement (newSession / restore) without re-firing on routine save/scheduleAutoSave
  useEffect(() => {
    const entry = useImageHistoryStore.getState().list.find((e) => e.id === currentId);
    if (!entry) return;
    const s = useImageStore.getState();
    s.reset();
    s.setSelected(entry.snapshot.selectedConnectionId);
    s.setPrompt(entry.snapshot.prompt);
    s.patchParams(entry.snapshot.params);
  }, [currentId, restoreVersion]);

  useEffect(() => {
    useImageHistoryStore.getState().scheduleAutoSave({
      selectedConnectionId: slice.selectedConnectionId,
      prompt: slice.prompt,
      params: slice.params,
    });
  }, [slice.selectedConnectionId, slice.prompt, slice.params]);

  // First-visit demo prompt seed (generate mode only).
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally mount-only
  useEffect(() => {
    const s = useImageStore.getState();
    if (s.prompt !== "") return;
    if (!consumeDemoSeed("image")) return;
    const demo = t("image.demoPrompt");
    if (demo) s.setPrompt(demo);
  }, []);

  const onSubmit = async () => {
    if (!conn) return;
    slice.setLoading(true);
    slice.setError(null);
    const seed = slice.params.randomSeedEachRequest
      ? Math.floor(Math.random() * 2 ** 31)
      : slice.params.seed;
    try {
      const body: PlaygroundImagesRequest = {
        apiBaseUrl: conn.apiBaseUrl,
        apiKey: conn.apiKey,
        model: conn.model,
        customHeaders: conn.customHeaders || undefined,
        queryParams: conn.queryParams || undefined,
        prompt: slice.prompt.trim(),
        size: slice.params.size,
        n: slice.params.n,
        seed,
        responseFormat: slice.params.responseFormat,
      };
      const res = await api.post<PlaygroundImagesResponse>("/api/playground/images", body);
      if (res.success) {
        slice.setResults(res.artifacts ?? []);
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

  const onRandomPrompt = () => {
    const rolls = [
      "A red apple on a white background",
      "A futuristic city skyline at sunset",
      "A cute robot watering plants in a greenhouse",
      "An impressionist oil painting of a quiet harbour",
    ];
    slice.setPrompt(rolls[Math.floor(Math.random() * rolls.length)]);
  };

  const snippets =
    conn && mode === "generate"
      ? genImagesSnippets({
          apiBaseUrl: conn.apiBaseUrl,
          model: conn.model,
          prompt: slice.prompt,
          size: slice.params.size,
          n: slice.params.n,
          responseFormat: slice.params.responseFormat,
          seed: slice.params.seed,
        })
      : null;

  return (
    <PlaygroundShell
      category="image"
      tabs={[
        { key: "generate", label: t("image.tabs.generate") },
        { key: "edit", label: t("image.tabs.edit") },
      ]}
      activeTab={mode}
      onTabChange={(k) => {
        const next = new URLSearchParams(searchParams);
        next.set("mode", k);
        setSearchParams(next, { replace: true });
      }}
      viewCodeSnippets={snippets}
      historySlot={
        mode === "generate" ? <HistoryDrawer useHistoryStore={useImageHistoryStore} /> : null
      }
      paramsSlot={
        <div className="space-y-4">
          <CategoryEndpointSelector
            category="image"
            selectedConnectionId={slice.selectedConnectionId}
            onSelect={slice.setSelected}
          />
          <ImageParamsPanel value={slice.params} onChange={slice.patchParams} />
        </div>
      }
    >
      <PageHeader title={t("image.title")} subtitle={t("image.subtitle")} />
      {mode === "generate" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 py-4">
          <div className="flex h-[60vh] items-center justify-center rounded-md border border-dashed border-border bg-muted/30">
            {slice.results.length === 0 ? (
              <span className="text-xs text-muted-foreground">{t("image.previewEmpty")}</span>
            ) : (
              <div className="grid grid-flow-col gap-3">
                {slice.results.map((a, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: artifacts replaced wholesale on each submit
                  <ImageArtifactView key={i} artifact={a} alt={slice.prompt} />
                ))}
              </div>
            )}
          </div>
          <PromptComposer
            value={slice.prompt}
            onChange={slice.setPrompt}
            onSubmit={onSubmit}
            sendLabel={slice.loading ? t("image.sending") : t("image.send")}
            sendDisabled={!canSubmit}
            placeholder={t("image.promptPlaceholder")}
            toolbar={
              <Button
                variant="outline"
                size="icon"
                type="button"
                onClick={onRandomPrompt}
                aria-label={t("image.random")}
              >
                <Dice5 className="h-4 w-4" />
              </Button>
            }
          />
          {slice.error ? <span className="text-xs text-destructive">{slice.error}</span> : null}
        </div>
      ) : (
        <InpaintMode />
      )}
    </PlaygroundShell>
  );
}

function ImageArtifactView({
  artifact,
  alt,
}: {
  artifact: { url?: string; b64Json?: string };
  alt: string;
}) {
  const src = artifact.url ?? (artifact.b64Json ? `data:image/png;base64,${artifact.b64Json}` : "");
  if (!src) return null;
  return (
    <div className="flex flex-col items-center gap-2">
      <img src={src} alt={alt || "Generated image"} className="max-h-[55vh] rounded-md" />
      <a
        href={src}
        download
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <Download className="h-3 w-3" /> Download
      </a>
    </div>
  );
}
