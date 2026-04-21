import { PageHeader } from "@/components/common/page-header";
import { EndpointSelector } from "@/components/connection/EndpointSelector";
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
import { useConnectionsStore } from "@/stores/connections-store";
import { useMutation } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CurlImport } from "./CurlImport";
import { LoadTestResults } from "./Results";
import { ChatForm } from "./forms/chat";
import { ChatAudioForm } from "./forms/chat-audio";
import { ChatVisionForm } from "./forms/chat-vision";
import { EmbeddingsForm } from "./forms/embeddings";
import { ImagesForm } from "./forms/images";
import { RerankForm } from "./forms/rerank";
import { type ManualEndpoint, useLoadTestStore } from "./store";
import { API_TYPES, type ApiType, type LoadTestResult } from "./types";

const formByType: Record<ApiType, () => JSX.Element> = {
	chat: ChatForm,
	embeddings: EmbeddingsForm,
	rerank: RerankForm,
	images: ImagesForm,
	"chat-vision": ChatVisionForm,
	"chat-audio": ChatAudioForm,
};

export function LoadTestPage() {
	const { t } = useTranslation("load-test");
	const { t: tc } = useTranslation("common");
	const slice = useLoadTestStore();
	const conns = useConnectionsStore();
	const createConn = useConnectionsStore((s) => s.create);
	const conn = slice.selectedConnectionId
		? conns.get(slice.selectedConnectionId)
		: null;
	const endpoint: ManualEndpoint = conn ?? slice.manualEndpoint;
	const isManual = !conn;

	const [error, setError] = useState<string | null>(null);
	const [progress, setProgress] = useState(0);
	const [revealKey, setRevealKey] = useState(false);
	const [saveName, setSaveName] = useState("");
	const [saveOpen, setSaveOpen] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const ActiveForm = formByType[slice.apiType];

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

	const onSaveAsConnection = () => {
		setSaveError(null);
		const name = saveName.trim();
		if (!name) {
			setSaveError(tc("errors.required"));
			return;
		}
		try {
			const created = createConn({
				name,
				apiUrl: slice.manualEndpoint.apiUrl,
				apiKey: slice.manualEndpoint.apiKey,
				model: slice.manualEndpoint.model,
				customHeaders: slice.manualEndpoint.customHeaders,
				queryParams: slice.manualEndpoint.queryParams,
			});
			slice.setSelected(created.id);
			setSaveName("");
			setSaveOpen(false);
		} catch (e) {
			setSaveError(e instanceof Error ? e.message : tc("errors.unknown"));
		}
	};

	const patchManual = (patch: Partial<ManualEndpoint>) => {
		slice.patch("manualEndpoint", { ...slice.manualEndpoint, ...patch });
	};

	const canSave =
		isManual &&
		slice.manualEndpoint.apiUrl.trim().length > 0 &&
		slice.manualEndpoint.apiKey.trim().length > 0 &&
		slice.manualEndpoint.model.trim().length > 0;

	return (
		<>
			<PageHeader
				title={t("title")}
				subtitle={t("subtitle")}
				rightSlot={
					<EndpointSelector
						selectedId={slice.selectedConnectionId}
						modified={slice.modified}
						onSelect={slice.setSelected}
					/>
				}
			/>
			<div className="space-y-6 px-8 py-6">
				{isManual ? (
					<Section
						title={t("sections.endpointManual")}
						hint={t("sections.endpointManualHint")}
						action={
							canSave ? (
								<Button
									type="button"
									size="sm"
									variant="outline"
									onClick={() => {
										setSaveOpen(true);
										setSaveError(null);
									}}
								>
									{t("actions.saveAsConnection")}
								</Button>
							) : null
						}
					>
						<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
							<div className="md:col-span-2">
								<Label>{t("fields.apiUrl")}</Label>
								<Input
									value={slice.manualEndpoint.apiUrl}
									onChange={(e) => patchManual({ apiUrl: e.target.value })}
									placeholder="http://host:port/v1/chat/completions"
									className="font-mono text-xs"
								/>
							</div>
							<div>
								<Label>{t("fields.apiKey")}</Label>
								<div className="relative">
									<Input
										type={revealKey ? "text" : "password"}
										value={slice.manualEndpoint.apiKey}
										onChange={(e) => patchManual({ apiKey: e.target.value })}
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
									value={slice.manualEndpoint.model}
									onChange={(e) => patchManual({ model: e.target.value })}
									placeholder="model-name"
									className="font-mono text-xs"
								/>
							</div>
							<div className="md:col-span-2">
								<Label>{t("fields.customHeaders")}</Label>
								<Textarea
									rows={2}
									value={slice.manualEndpoint.customHeaders}
									onChange={(e) =>
										patchManual({ customHeaders: e.target.value })
									}
									placeholder="Header-Name: value"
									className="font-mono text-xs"
								/>
							</div>
							<div className="md:col-span-2">
								<Label>{t("fields.queryParams")}</Label>
								<Textarea
									rows={2}
									value={slice.manualEndpoint.queryParams}
									onChange={(e) => patchManual({ queryParams: e.target.value })}
									placeholder="key=value"
									className="font-mono text-xs"
								/>
							</div>
						</div>

						{saveOpen ? (
							<div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-muted/30 p-2">
								<Input
									autoFocus
									value={saveName}
									onChange={(e) => setSaveName(e.target.value)}
									placeholder="connection-name"
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
								<Button type="button" size="sm" onClick={onSaveAsConnection}>
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
				) : null}

				<Section title={t("sections.request")}>
					<div className="space-y-3">
						<div className="grid grid-cols-2 gap-3">
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
						</div>
						<details
							open={slice.curlExpanded}
							onToggle={(e) =>
								slice.patch(
									"curlExpanded",
									(e.target as HTMLDetailsElement).open,
								)
							}
						>
							<summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
								{t("curl.import")}
							</summary>
							<div className="mt-2">
								<CurlImport />
							</div>
						</details>
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
	hint,
	action,
	children,
}: {
	title: string;
	hint?: string;
	action?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<section className="rounded-lg border border-border bg-card p-4">
			<div className="mb-3 flex items-start justify-between gap-2">
				<div>
					<h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
						{title}
					</h2>
					{hint ? (
						<p className="mt-1 text-xs text-muted-foreground">{hint}</p>
					) : null}
				</div>
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
