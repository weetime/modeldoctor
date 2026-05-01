import { PageHeader } from "@/components/common/page-header";
import { EndpointPicker } from "@/components/connection/EndpointPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError, api } from "@/lib/api-client";
import { type ParsedCurl, detectApiType } from "@/lib/curl-parser";
import type { EndpointValues } from "@/lib/endpoint-values";
import { loadTestApiTypePath } from "@modeldoctor/contracts";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { LoadTestResults } from "./Results";
import { ChatForm } from "./forms/chat";
import { ChatAudioForm } from "./forms/chat-audio";
import { ChatVisionForm } from "./forms/chat-vision";
import { EmbeddingsForm } from "./forms/embeddings";
import { ImagesForm } from "./forms/images";
import { RerankForm } from "./forms/rerank";
import { useLoadTestStore } from "./store";
import { API_TYPES, type ApiType, type LoadTestResult } from "./types";

const formByType: Record<ApiType, () => JSX.Element> = {
  chat: ChatForm,
  embeddings: EmbeddingsForm,
  rerank: RerankForm,
  images: ImagesForm,
  "chat-vision": ChatVisionForm,
  "chat-audio": ChatAudioForm,
};

function extractUserPrompt(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string; content?: unknown };
    if (m?.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      const textPart = m.content.find(
        (p: unknown) => p && typeof p === "object" && (p as { type?: string }).type === "text",
      ) as { text?: string } | undefined;
      if (textPart?.text) return textPart.text;
    }
  }
  return null;
}

function extractImageUrl(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null;
  for (const m of messages) {
    const content = (m as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const p = part as { type?: string; image_url?: { url?: string } };
      if (p?.type === "image_url" && p.image_url?.url) return p.image_url.url;
    }
  }
  return null;
}

function extractSystemPrompt(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null;
  for (const m of messages) {
    const x = m as { role?: string; content?: unknown };
    if (x?.role === "system" && typeof x.content === "string") return x.content;
  }
  return null;
}

export function LoadTestPage() {
  const { t } = useTranslation("load-test");
  const { t: tc } = useTranslation("common");
  const slice = useLoadTestStore();

  const ActiveForm = formByType[slice.apiType];

  const endpoint = slice.manualEndpoint;

  const onEndpointChange = (next: EndpointValues) => {
    slice.patch("manualEndpoint", next);
  };

  const onCurlParsed = (parsed: ParsedCurl) => {
    const body = parsed.body as Record<string, unknown> | null;
    const detected: ApiType = detectApiType(parsed.url, body);
    slice.setApiType(detected);

    if (detected === "chat" && body) {
      const next = { ...slice.chat };
      const prompt = extractUserPrompt(body.messages);
      if (prompt != null) next.prompt = prompt;
      if (typeof body.max_tokens === "number") next.maxTokens = body.max_tokens;
      if (typeof body.temperature === "number") next.temperature = body.temperature;
      if (typeof body.stream === "boolean") next.stream = body.stream;
      slice.patch("chat", next);
    }
    if (detected === "embeddings" && body) {
      const input = body.input;
      const text = Array.isArray(input)
        ? input.filter((x) => typeof x === "string").join("\n")
        : typeof input === "string"
          ? input
          : null;
      if (text) {
        slice.patch("embeddings", {
          ...slice.embeddings,
          embeddingInput: text,
        });
      }
    }
    if (detected === "rerank" && body) {
      const next = { ...slice.rerank };
      if (typeof body.query === "string") next.rerankQuery = body.query;
      if (Array.isArray(body.texts)) {
        next.rerankTexts = body.texts.filter((x) => typeof x === "string").join("\n");
      }
      slice.patch("rerank", next);
    }
    if (detected === "images" && body) {
      const next = { ...slice.images };
      if (typeof body.prompt === "string") next.imagePrompt = body.prompt;
      if (typeof body.size === "string") next.imageSize = body.size;
      if (typeof body.n === "number") next.imageN = body.n;
      slice.patch("images", next);
    }
    if (detected === "chat-vision" && body) {
      const next = { ...slice.chatVision };
      const imageUrl = extractImageUrl(body.messages);
      if (imageUrl) next.imageUrl = imageUrl;
      const prompt = extractUserPrompt(body.messages);
      if (prompt) next.prompt = prompt;
      const sys = extractSystemPrompt(body.messages);
      if (sys) next.systemPrompt = sys;
      if (typeof body.max_tokens === "number") next.maxTokens = body.max_tokens;
      if (typeof body.temperature === "number") next.temperature = body.temperature;
      slice.patch("chatVision", next);
    }
    if (detected === "chat-audio" && body) {
      const next = { ...slice.chatAudio };
      const prompt = extractUserPrompt(body.messages);
      if (prompt) next.prompt = prompt;
      const sys = extractSystemPrompt(body.messages);
      if (sys) next.systemPrompt = sys;
      slice.patch("chatAudio", next);
    }
  };

  const mutation = useMutation<LoadTestResult, ApiError>({
    mutationFn: async () => {
      if (!slice.selectedConnectionId) {
        throw new ApiError(400, tc("errors.required"));
      }
      const body = buildLoadTestBody(slice, slice.selectedConnectionId);
      return api.post("/api/load-test", body);
    },
    onSuccess: (data) => {
      slice.setLastResult(data);
      slice.setProgress(100);
    },
    onError: (e) => slice.setError(e.message),
  });

  const onStart = () => {
    slice.resetResults();
    const totalMs = slice.attack.duration * 1000;
    const startedAt = Date.now();
    const tick = setInterval(() => {
      const pct = Math.min(99, ((Date.now() - startedAt) / totalMs) * 100);
      slice.setProgress(pct);
      if (mutation.isIdle === false && !mutation.isPending) clearInterval(tick);
    }, 250);
    mutation.mutate(undefined, { onSettled: () => clearInterval(tick) });
  };

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="space-y-6 px-8 py-6">
        <EndpointPicker
          endpoint={endpoint}
          selectedConnectionId={slice.selectedConnectionId}
          onSelect={(id) => {
            slice.setSelected(id);
            slice.resetResults();
          }}
          onEndpointChange={onEndpointChange}
          onCurlParsed={onCurlParsed}
          previewUrl={
            endpoint.apiBaseUrl
              ? `${endpoint.apiBaseUrl}${loadTestApiTypePath(slice.apiType)}`
              : undefined
          }
        />

        <Section title={t("sections.request")}>
          <div className="max-w-xs">
            <Label>{t("fields.apiType")}</Label>
            <Select value={slice.apiType} onValueChange={(v) => slice.setApiType(v as ApiType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {API_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </Section>

        <Section title={t("sections.parameters")}>
          <ActiveForm />
        </Section>

        <Section title={t("sections.attack")}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("fields.rate")}</Label>
              <Input
                type="number"
                value={slice.attack.rate}
                onChange={(e) =>
                  slice.patch("attack", {
                    ...slice.attack,
                    rate: Number(e.target.value),
                  })
                }
              />
            </div>
            <div>
              <Label>{t("fields.duration")}</Label>
              <Input
                type="number"
                value={slice.attack.duration}
                onChange={(e) =>
                  slice.patch("attack", {
                    ...slice.attack,
                    duration: Number(e.target.value),
                  })
                }
              />
            </div>
          </div>
        </Section>

        <div className="flex items-center gap-2">
          <Button onClick={onStart} disabled={mutation.isPending}>
            {mutation.isPending ? t("attack.running") : t("attack.start")}
          </Button>
          <Button variant="ghost" onClick={() => slice.resetResults()}>
            {tc("actions.reset")}
          </Button>
        </div>

        {mutation.isPending ? <Progress value={slice.progress} className="h-1" /> : null}

        <LoadTestResults result={slice.lastResult} error={slice.error} />
      </div>
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function buildLoadTestBody(s: ReturnType<typeof useLoadTestStore.getState>, connectionId: string) {
  const base = {
    connectionId,
    apiType: s.apiType,
    rate: s.attack.rate,
    duration: s.attack.duration,
  };
  switch (s.apiType) {
    case "chat":
      return { ...base, ...s.chat };
    case "embeddings":
      return { ...base, ...s.embeddings };
    case "rerank":
      return { ...base, ...s.rerank };
    case "images":
      return { ...base, ...s.images };
    case "chat-vision":
      return {
        ...base,
        visionImageUrl: s.chatVision.imageUrl,
        visionPrompt: s.chatVision.prompt,
        visionSystemPrompt: s.chatVision.systemPrompt,
        visionMaxTokens: s.chatVision.maxTokens,
        visionTemperature: s.chatVision.temperature,
      };
    case "chat-audio":
      return {
        ...base,
        audioPrompt: s.chatAudio.prompt,
        audioSystemPrompt: s.chatAudio.systemPrompt,
      };
  }
}
