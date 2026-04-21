import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EndpointSelector } from "@/components/connection/EndpointSelector";
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
import { ApiError, api } from "@/lib/api-client";
import { useConnectionsStore } from "@/stores/connections-store";
import type { Connection } from "@/types/connection";
import { CurlImport } from "./CurlImport";
import { ChatForm } from "./forms/chat";
import { ChatAudioForm } from "./forms/chat-audio";
import { ChatVisionForm } from "./forms/chat-vision";
import { EmbeddingsForm } from "./forms/embeddings";
import { ImagesForm } from "./forms/images";
import { RerankForm } from "./forms/rerank";
import { LoadTestResults } from "./Results";
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

export function LoadTestPage() {
	const { t } = useTranslation("load-test");
	const { t: tc } = useTranslation("common");
	const slice = useLoadTestStore();
	const conns = useConnectionsStore();
	const conn = slice.selectedConnectionId ? conns.get(slice.selectedConnectionId) : null;
	const [error, setError] = useState<string | null>(null);
	const [progress, setProgress] = useState(0);
	const ActiveForm = formByType[slice.apiType];

	const mutation = useMutation<LoadTestResult, ApiError>({
		mutationFn: async () => {
			if (!conn) throw new ApiError(400, "Select a connection or enter manual values.");
			const body = buildLoadTestBody(slice, conn);
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
								slice.patch("curlExpanded", (e.target as HTMLDetailsElement).open)
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
									slice.patch("attack", { ...slice.attack, rate: Number(e.target.value) })
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

				{mutation.isPending ? <Progress value={progress} className="h-1" /> : null}

				<LoadTestResults result={slice.lastResult} error={error} />
			</div>
		</>
	);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<section className="rounded-lg border border-border bg-card p-4">
			<h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
				{title}
			</h2>
			{children}
		</section>
	);
}

function buildLoadTestBody(
	s: ReturnType<typeof useLoadTestStore.getState>,
	conn: Connection,
) {
	const base = {
		apiType: s.apiType,
		apiUrl: conn.apiUrl,
		apiKey: conn.apiKey,
		model: conn.model,
		customHeaders: conn.customHeaders,
		queryParams: conn.queryParams,
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
