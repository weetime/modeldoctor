import { PageHeader } from "@/components/common/page-header";
import { EndpointSelector } from "@/components/connection/EndpointSelector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api-client";
import { parseCurlCommand } from "@/lib/curl-parser";
import { useConnectionsStore } from "@/stores/connections-store";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { KeyValueTable } from "./KeyValueTable";
import { ResponseViewer } from "./ResponseViewer";
import { useDebugStore } from "./store";
import type { DebugProxyResponse, DebugResponse, HttpMethod } from "./types";

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "DELETE", "PATCH"];

export function RequestDebugPage() {
	const { t } = useTranslation("debug");
	const { t: tc } = useTranslation("common");
	const slice = useDebugStore();
	const conns = useConnectionsStore();

	const onSelect = (id: string | null) => {
		slice.setSelected(id);
		slice.resetResults();
		if (id) {
			const c = conns.get(id);
			if (c) {
				slice.patch("url", c.apiUrl);
				const apiKeyHeader = {
					key: "Authorization",
					value: `Bearer ${c.apiKey}`,
					enabled: true,
				};
				const ctHeader = {
					key: "Content-Type",
					value: "application/json",
					enabled: true,
				};
				slice.patch("headers", [apiKeyHeader, ctHeader]);
			}
		}
	};

	const onParseCurl = () => {
		const parsed = parseCurlCommand(slice.curlInput);
		if (parsed.url) slice.patch("url", parsed.url);
		const headers = Object.entries(parsed.headers).map(([, h]) => ({
			key: h.originalKey,
			value: h.value,
			enabled: true,
		}));
		if (headers.length) slice.patch("headers", headers);
		if (parsed.queryParams) {
			const q = parsed.queryParams.split("\n").map((line) => {
				const [k, ...v] = line.split("=");
				return { key: k, value: v.join("="), enabled: true };
			});
			slice.patch("query", q);
		}
		if (parsed.body) slice.patch("body", JSON.stringify(parsed.body, null, 2));
	};

	const onFormat = () => {
		try {
			slice.patch("body", JSON.stringify(JSON.parse(slice.body), null, 2));
		} catch {
			slice.setLastError(t("errors.invalidJson"));
		}
	};

	const mutation = useMutation<DebugResponse, ApiError>({
		mutationFn: async () => {
			const headers: Record<string, string> = {};
			for (const r of slice.headers) {
				if (r.enabled && r.key) headers[r.key] = r.value;
			}
			let url = slice.url;
			if (slice.query.length) {
				const params = new URLSearchParams();
				for (const r of slice.query) {
					if (r.enabled && r.key) params.set(r.key, r.value);
				}
				const qs = params.toString();
				if (qs) url += (url.includes("?") ? "&" : "?") + qs;
			}
			const proxy = await api.post<DebugProxyResponse>("/api/debug/proxy", {
				method: slice.method,
				url,
				headers,
				body: ["GET", "HEAD"].includes(slice.method) ? null : slice.body,
			});
			if (!proxy.success || !proxy.headers || !proxy.timingMs) {
				throw new ApiError(proxy.status ?? 0, proxy.error ?? "proxy error");
			}
			return {
				status: proxy.status ?? 0,
				statusText: proxy.statusText ?? "",
				headers: proxy.headers,
				body: proxy.body ?? "",
				bodyEncoding: proxy.bodyEncoding ?? "text",
				timingMs: proxy.timingMs,
				sizeBytes: proxy.sizeBytes ?? 0,
			};
		},
		onSuccess: (r) => slice.setLastResponse(r),
		onError: (e) => slice.setLastError(e.message),
	});

	return (
		<>
			<PageHeader
				title={t("title")}
				subtitle={t("subtitle")}
				rightSlot={
					<EndpointSelector
						selectedId={slice.selectedConnectionId}
						modified={false}
						onSelect={onSelect}
					/>
				}
			/>
			<div className="space-y-6 px-8 py-6">
				<details>
					<summary className="cursor-pointer text-sm font-semibold text-muted-foreground hover:text-foreground">
						{t("sections.paste")}
					</summary>
					<div className="mt-2 space-y-2">
						<Textarea
							rows={5}
							className="font-mono text-xs"
							placeholder={`curl http://example/v1/chat/completions \\\n  -H "Authorization: Bearer …"`}
							value={slice.curlInput}
							onChange={(e) => slice.patch("curlInput", e.target.value)}
						/>
						<Button size="sm" onClick={onParseCurl}>
							{t("actions.send")}
						</Button>
					</div>
				</details>

				<section className="space-y-3 rounded-lg border border-border bg-card p-4">
					<div className="grid grid-cols-[120px,1fr] gap-3">
						<div>
							<Label>{t("fields.method")}</Label>
							<Select
								value={slice.method}
								onValueChange={(v) => slice.patch("method", v as HttpMethod)}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{METHODS.map((m) => (
										<SelectItem key={m} value={m}>
											{m}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div>
							<Label>{t("fields.url")}</Label>
							<Input
								value={slice.url}
								onChange={(e) => slice.patch("url", e.target.value)}
								className="font-mono text-xs"
							/>
						</div>
					</div>

					<Tabs defaultValue="headers">
						<TabsList>
							<TabsTrigger value="headers">{t("fields.headers")}</TabsTrigger>
							<TabsTrigger value="body">{t("fields.body")}</TabsTrigger>
							<TabsTrigger value="query">{t("fields.query")}</TabsTrigger>
						</TabsList>
						<TabsContent value="headers">
							<KeyValueTable
								rows={slice.headers}
								onChange={(r) => slice.patch("headers", r)}
							/>
						</TabsContent>
						<TabsContent value="body">
							<div className="space-y-2">
								<Textarea
									rows={10}
									className="font-mono text-xs"
									value={slice.body}
									onChange={(e) => slice.patch("body", e.target.value)}
								/>
								<Button size="sm" variant="outline" onClick={onFormat}>
									{t("actions.format")}
								</Button>
							</div>
						</TabsContent>
						<TabsContent value="query">
							<KeyValueTable
								rows={slice.query}
								onChange={(r) => slice.patch("query", r)}
							/>
						</TabsContent>
					</Tabs>

					<div className="flex gap-2">
						<Button
							onClick={() => mutation.mutate()}
							disabled={mutation.isPending || !slice.url}
						>
							{mutation.isPending ? "…" : t("actions.send")}
						</Button>
						<Button variant="ghost" onClick={() => slice.resetResults()}>
							{tc("actions.clear")}
						</Button>
					</div>
				</section>

				<section className="rounded-lg border border-border bg-card p-4">
					<h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
						{t("sections.response")}
					</h2>
					{slice.lastResponse || slice.lastError ? (
						<ResponseViewer
							response={slice.lastResponse}
							error={slice.lastError}
						/>
					) : (
						<p className="text-sm text-muted-foreground">{t("empty.body")}</p>
					)}
				</section>
			</div>
		</>
	);
}
