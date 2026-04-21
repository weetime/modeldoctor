import { PageHeader } from "@/components/common/page-header";
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
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api-client";
import { detectApiType, parseCurlCommand } from "@/lib/curl-parser";
import { useConnectionsStore } from "@/stores/connections-store";
import { useMutation } from "@tanstack/react-query";
import { ClipboardPaste, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LoadTestResults } from "./Results";
import { ChatForm } from "./forms/chat";
import { ChatAudioForm } from "./forms/chat-audio";
import { ChatVisionForm } from "./forms/chat-vision";
import { EmbeddingsForm } from "./forms/embeddings";
import { ImagesForm } from "./forms/images";
import { RerankForm } from "./forms/rerank";
import { type ManualEndpoint, useLoadTestStore } from "./store";
import { API_TYPES, type ApiType, type LoadTestResult } from "./types";

const MANUAL = "__manual__";

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
				(p: unknown) =>
					p &&
					typeof p === "object" &&
					(p as { type?: string }).type === "text",
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
	const conns = useConnectionsStore();
	const connectionList = conns.list();
	const createConn = useConnectionsStore((s) => s.create);
	const updateConn = useConnectionsStore((s) => s.update);
	const selectedConn = slice.selectedConnectionId
		? conns.get(slice.selectedConnectionId)
		: null;

	const [error, setError] = useState<string | null>(null);
	const [progress, setProgress] = useState(0);
	const [revealKey, setRevealKey] = useState(false);
	const [curlOpen, setCurlOpen] = useState(false);
	const [curlText, setCurlText] = useState("");
	const [curlFeedback, setCurlFeedback] = useState<string | null>(null);
	const [saveOpen, setSaveOpen] = useState(false);
	const [saveName, setSaveName] = useState("");
	const [saveError, setSaveError] = useState<string | null>(null);
	const ActiveForm = formByType[slice.apiType];

	const endpoint = slice.manualEndpoint;
	const isDirty =
		!!selectedConn &&
		(selectedConn.apiUrl !== endpoint.apiUrl ||
			selectedConn.apiKey !== endpoint.apiKey ||
			selectedConn.model !== endpoint.model ||
			selectedConn.customHeaders !== endpoint.customHeaders ||
			selectedConn.queryParams !== endpoint.queryParams);

	const patchEndpoint = (patch: Partial<ManualEndpoint>) => {
		slice.patch("manualEndpoint", { ...slice.manualEndpoint, ...patch });
	};

	const onSelectConnection = (value: string) => {
		if (value === MANUAL) {
			slice.setSelected(null);
			return;
		}
		const c = conns.get(value);
		if (c) {
			slice.setSelected(c.id);
			slice.patch("manualEndpoint", {
				apiUrl: c.apiUrl,
				apiKey: c.apiKey,
				model: c.model,
				customHeaders: c.customHeaders,
				queryParams: c.queryParams,
			});
		}
	};

	const onSaveClick = () => {
		setSaveError(null);
		if (selectedConn) {
			try {
				updateConn(selectedConn.id, endpoint);
			} catch (e) {
				setSaveError(e instanceof Error ? e.message : tc("errors.unknown"));
			}
			return;
		}
		setSaveOpen(true);
		setSaveName("");
	};

	const onSaveAsSubmit = () => {
		setSaveError(null);
		const name = saveName.trim();
		if (!name) {
			setSaveError(tc("errors.required"));
			return;
		}
		try {
			const created = createConn({ name, ...endpoint });
			slice.setSelected(created.id);
			setSaveOpen(false);
			setSaveName("");
		} catch (e) {
			setSaveError(e instanceof Error ? e.message : tc("errors.unknown"));
		}
	};

	const onParseCurl = () => {
		const parsed = parseCurlCommand(curlText);
		if (!parsed.url && !parsed.body) {
			setCurlFeedback(t("curl.filled", { fields: "—" }));
			return;
		}
		const detected: ApiType = detectApiType(parsed.url, parsed.body);
		slice.setApiType(detected);
		const filled: string[] = [`type=${detected}`];

		slice.setSelected(null);
		const nextEndpoint: ManualEndpoint = { ...slice.manualEndpoint };
		if (parsed.url) {
			nextEndpoint.apiUrl = parsed.url;
			filled.push("apiUrl");
		}
		if (parsed.queryParams) {
			nextEndpoint.queryParams = parsed.queryParams;
			filled.push("queryParams");
		}
		const auth = parsed.headers.authorization;
		if (auth) {
			const key = auth.value.replace(/^Bearer\s+/i, "").trim();
			if (key) {
				nextEndpoint.apiKey = key;
				filled.push("apiKey");
			}
		}
		const customLines: string[] = [];
		for (const [lower, entry] of Object.entries(parsed.headers)) {
			if (lower === "authorization" || lower === "content-type") continue;
			customLines.push(`${entry.originalKey}: ${entry.value}`);
		}
		if (customLines.length) {
			nextEndpoint.customHeaders = customLines.join("\n");
			filled.push("customHeaders");
		}
		const body = parsed.body as Record<string, unknown> | null;
		if (body && typeof body.model === "string") {
			nextEndpoint.model = body.model;
			filled.push("model");
		}
		slice.patch("manualEndpoint", nextEndpoint);

		if (detected === "chat" && body) {
			const next = { ...slice.chat };
			const prompt = extractUserPrompt(body.messages);
			if (prompt != null) {
				next.prompt = prompt;
				filled.push("prompt");
			}
			if (typeof body.max_tokens === "number") {
				next.maxTokens = body.max_tokens;
				filled.push("maxTokens");
			}
			if (typeof body.temperature === "number") {
				next.temperature = body.temperature;
				filled.push("temperature");
			}
			if (typeof body.stream === "boolean") {
				next.stream = body.stream;
				filled.push("stream");
			}
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
				filled.push("input");
			}
		}
		if (detected === "rerank" && body) {
			const next = { ...slice.rerank };
			if (typeof body.query === "string") {
				next.rerankQuery = body.query;
				filled.push("query");
			}
			if (Array.isArray(body.texts)) {
				next.rerankTexts = body.texts
					.filter((x) => typeof x === "string")
					.join("\n");
				filled.push("texts");
			}
			slice.patch("rerank", next);
		}
		if (detected === "images" && body) {
			const next = { ...slice.images };
			if (typeof body.prompt === "string") {
				next.imagePrompt = body.prompt;
				filled.push("prompt");
			}
			if (typeof body.size === "string") {
				next.imageSize = body.size;
				filled.push("size");
			}
			if (typeof body.n === "number") {
				next.imageN = body.n;
				filled.push("n");
			}
			slice.patch("images", next);
		}
		if (detected === "chat-vision" && body) {
			const next = { ...slice.chatVision };
			const imageUrl = extractImageUrl(body.messages);
			if (imageUrl) {
				next.imageUrl = imageUrl;
				filled.push("imageUrl");
			}
			const prompt = extractUserPrompt(body.messages);
			if (prompt) {
				next.prompt = prompt;
				filled.push("prompt");
			}
			const sys = extractSystemPrompt(body.messages);
			if (sys) {
				next.systemPrompt = sys;
				filled.push("systemPrompt");
			}
			if (typeof body.max_tokens === "number") {
				next.maxTokens = body.max_tokens;
				filled.push("maxTokens");
			}
			if (typeof body.temperature === "number") {
				next.temperature = body.temperature;
				filled.push("temperature");
			}
			slice.patch("chatVision", next);
		}
		if (detected === "chat-audio" && body) {
			const next = { ...slice.chatAudio };
			const prompt = extractUserPrompt(body.messages);
			if (prompt) {
				next.prompt = prompt;
				filled.push("prompt");
			}
			const sys = extractSystemPrompt(body.messages);
			if (sys) {
				next.systemPrompt = sys;
				filled.push("systemPrompt");
			}
			slice.patch("chatAudio", next);
		}

		setCurlFeedback(t("curl.filled", { fields: filled.join(", ") }));
		setCurlText("");
		setTimeout(() => setCurlOpen(false), 1200);
	};

	const mutation = useMutation<LoadTestResult, ApiError>({
		mutationFn: async () => {
			if (!endpoint.apiUrl || !endpoint.apiKey || !endpoint.model) {
				throw new ApiError(400, tc("errors.required"));
			}
			const body = buildLoadTestBody(slice, endpoint);
			return api.post("/api/load-test", body);
		},
		onSuccess: (data) => {
			slice.setLastResult(data);
			setProgress(100);
		},
		onError: (e) => setError(e.message),
	});

	const onStart = () => {
		setError(null);
		setProgress(0);
		slice.setLastResult(null);
		const totalMs = slice.attack.duration * 1000;
		const startedAt = Date.now();
		const tick = setInterval(() => {
			const pct = Math.min(99, ((Date.now() - startedAt) / totalMs) * 100);
			setProgress(pct);
			if (mutation.isIdle === false && !mutation.isPending) clearInterval(tick);
		}, 250);
		mutation.mutate(undefined, { onSettled: () => clearInterval(tick) });
	};

	return (
		<>
			<PageHeader title={t("title")} subtitle={t("subtitle")} />
			<div className="space-y-6 px-8 py-6">
				<Section
					title={t("sections.endpoint")}
					action={
						<div className="flex flex-wrap items-center gap-2">
							<Select
								value={slice.selectedConnectionId ?? MANUAL}
								onValueChange={onSelectConnection}
							>
								<SelectTrigger className="h-8 min-w-[180px] text-xs">
									<SelectValue placeholder={t("actions.loadFromSaved")} />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={MANUAL}>{t("actions.manual")}</SelectItem>
									{connectionList.map((c) => (
										<SelectItem key={c.id} value={c.id}>
											{c.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							{isDirty ? (
								<span
									className="h-2 w-2 rounded-full bg-warning"
									title={t("actions.modified")}
									aria-label={t("actions.modified")}
								/>
							) : null}
							<Button
								type="button"
								size="sm"
								variant="outline"
								onClick={onSaveClick}
								disabled={
									!endpoint.apiUrl || !endpoint.apiKey || !endpoint.model
								}
							>
								{selectedConn ? t("actions.save") : t("actions.saveAs")}
							</Button>
							<Button
								type="button"
								size="sm"
								variant="outline"
								onClick={() => {
									setCurlOpen((v) => !v);
									setCurlFeedback(null);
								}}
							>
								<ClipboardPaste className="h-3.5 w-3.5" />
								<span className="ml-1">{t("actions.pasteCurl")}</span>
							</Button>
						</div>
					}
				>
					<div className="space-y-3">
						<div>
							<Label>{t("fields.apiUrl")}</Label>
							<Input
								value={endpoint.apiUrl}
								onChange={(e) => patchEndpoint({ apiUrl: e.target.value })}
								placeholder="http://host:port/v1/chat/completions"
								className="font-mono text-xs"
							/>
						</div>
						<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
							<div>
								<Label>{t("fields.apiKey")}</Label>
								<div className="relative">
									<Input
										type={revealKey ? "text" : "password"}
										value={endpoint.apiKey}
										onChange={(e) => patchEndpoint({ apiKey: e.target.value })}
										placeholder="sk-…"
										className="font-mono text-xs"
									/>
									<button
										type="button"
										onClick={() => setRevealKey((v) => !v)}
										className="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground"
										aria-label={revealKey ? "hide" : "show"}
									>
										{revealKey ? (
											<EyeOff className="h-4 w-4" />
										) : (
											<Eye className="h-4 w-4" />
										)}
									</button>
								</div>
							</div>
							<div>
								<Label>{t("fields.model")}</Label>
								<Input
									value={endpoint.model}
									onChange={(e) => patchEndpoint({ model: e.target.value })}
									placeholder="model-name"
									className="font-mono text-xs"
								/>
							</div>
						</div>
						<details>
							<summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
								{t("sections.advanced")}
							</summary>
							<div className="mt-2 space-y-3">
								<div>
									<Label>{t("fields.customHeaders")}</Label>
									<Textarea
										rows={2}
										value={endpoint.customHeaders}
										onChange={(e) =>
											patchEndpoint({ customHeaders: e.target.value })
										}
										placeholder="Header-Name: value"
										className="font-mono text-xs"
									/>
								</div>
								<div>
									<Label>{t("fields.queryParams")}</Label>
									<Textarea
										rows={2}
										value={endpoint.queryParams}
										onChange={(e) =>
											patchEndpoint({ queryParams: e.target.value })
										}
										placeholder="key=value"
										className="font-mono text-xs"
									/>
								</div>
							</div>
						</details>
					</div>

					{curlOpen ? (
						<div className="mt-3 space-y-2 rounded-md border border-border bg-muted/30 p-3">
							<Textarea
								rows={5}
								value={curlText}
								onChange={(e) => setCurlText(e.target.value)}
								placeholder={`curl http://example/v1/chat/completions \\\n  -H "Authorization: Bearer sk-\u2026" \\\n  -d '{...}'`}
								className="font-mono text-xs"
							/>
							<div className="flex items-center gap-2">
								<Button
									type="button"
									size="sm"
									onClick={onParseCurl}
									disabled={!curlText.trim()}
								>
									{t("curl.parse")}
								</Button>
								<Button
									type="button"
									size="sm"
									variant="ghost"
									onClick={() => {
										setCurlOpen(false);
										setCurlFeedback(null);
									}}
								>
									{tc("actions.cancel")}
								</Button>
								{curlFeedback ? (
									<span className="text-xs text-success">{curlFeedback}</span>
								) : null}
							</div>
						</div>
					) : null}

					{saveOpen ? (
						<div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-muted/30 p-2">
							<Input
								value={saveName}
								onChange={(e) => setSaveName(e.target.value)}
								placeholder={t("actions.nameConnection")}
								className="h-8 font-mono text-xs"
							/>
							<Button
								type="button"
								size="sm"
								variant="ghost"
								onClick={() => {
									setSaveOpen(false);
									setSaveError(null);
								}}
							>
								{tc("actions.cancel")}
							</Button>
							<Button type="button" size="sm" onClick={onSaveAsSubmit}>
								{tc("actions.save")}
							</Button>
							{saveError ? (
								<span className="text-xs text-destructive">
									{saveError.toLowerCase().includes("exists")
										? "name exists"
										: saveError}
								</span>
							) : null}
						</div>
					) : null}
				</Section>

				<Section title={t("sections.request")}>
					<div>
						<Label>{t("fields.apiType")}</Label>
						<Select
							value={slice.apiType}
							onValueChange={(v) => slice.setApiType(v as ApiType)}
						>
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
					<Button
						variant="ghost"
						onClick={() => {
							slice.setLastResult(null);
							setError(null);
							setProgress(0);
						}}
					>
						{tc("actions.reset")}
					</Button>
				</div>

				{mutation.isPending ? (
					<Progress value={progress} className="h-1" />
				) : null}

				<LoadTestResults result={slice.lastResult} error={error} />
			</div>
		</>
	);
}

function Section({
	title,
	action,
	children,
}: {
	title: string;
	action?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<section className="rounded-lg border border-border bg-card p-4">
			<div className="mb-3 flex items-center justify-between gap-2">
				<h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
					{title}
				</h2>
				{action}
			</div>
			{children}
		</section>
	);
}

function buildLoadTestBody(
	s: ReturnType<typeof useLoadTestStore.getState>,
	endpoint: ManualEndpoint,
) {
	const base = {
		apiType: s.apiType,
		apiUrl: endpoint.apiUrl,
		apiKey: endpoint.apiKey,
		model: endpoint.model,
		customHeaders: endpoint.customHeaders,
		queryParams: endpoint.queryParams,
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
