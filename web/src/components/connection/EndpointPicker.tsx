import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ConnectionDialog } from "@/features/connections/ConnectionDialog";
import { type ParsedCurl, parseCurlCommand } from "@/lib/curl-parser";
import { useConnectionsStore } from "@/stores/connections-store";
import { type EndpointValues, emptyEndpointValues } from "@/types/connection";
import { ClipboardPaste, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

const MANUAL = "__manual__";
const NEW_CONNECTION = "__new__";

export interface EndpointPickerProps {
	/** Current endpoint values (URL/Key/Model/Headers/Query). */
	endpoint: EndpointValues;
	/** Currently loaded connection id, or null for manual/unsaved. */
	selectedConnectionId: string | null;
	/** Called when the user selects a saved connection or "Manual". */
	onSelect: (id: string | null) => void;
	/** Called when the endpoint values change (user typing or curl parse). */
	onEndpointChange: (values: EndpointValues) => void;
	/**
	 * Optional: consumers that care about curl body (e.g. to populate their
	 * own request-parameter slice) can subscribe. Called after endpoint fields
	 * have been populated from the parsed curl.
	 */
	onCurlParsed?: (parsed: ParsedCurl) => void;
}

/**
 * Unified endpoint editor + connection loader + curl import. The single
 * source of truth for the endpoint values is the controlled `endpoint` prop;
 * consumers own state.
 */
export function EndpointPicker({
	endpoint,
	selectedConnectionId,
	onSelect,
	onEndpointChange,
	onCurlParsed,
}: EndpointPickerProps) {
	const { t } = useTranslation("common");
	const conns = useConnectionsStore();
	const connectionList = conns.list();
	const createConn = useConnectionsStore((s) => s.create);
	const updateConn = useConnectionsStore((s) => s.update);
	const selectedConn = selectedConnectionId
		? conns.get(selectedConnectionId)
		: null;

	const [revealKey, setRevealKey] = useState(false);
	const [curlOpen, setCurlOpen] = useState(false);
	const [curlText, setCurlText] = useState("");
	const [curlFeedback, setCurlFeedback] = useState<string | null>(null);
	const [saveOpen, setSaveOpen] = useState(false);
	const [saveName, setSaveName] = useState("");
	const [saveError, setSaveError] = useState<string | null>(null);
	const [newDialogOpen, setNewDialogOpen] = useState(false);

	const isDirty =
		!!selectedConn &&
		(selectedConn.apiUrl !== endpoint.apiUrl ||
			selectedConn.apiKey !== endpoint.apiKey ||
			selectedConn.model !== endpoint.model ||
			selectedConn.customHeaders !== endpoint.customHeaders ||
			selectedConn.queryParams !== endpoint.queryParams);

	const canSave =
		endpoint.apiUrl.trim().length > 0 &&
		endpoint.apiKey.trim().length > 0 &&
		endpoint.model.trim().length > 0;

	const patchEndpoint = (patch: Partial<EndpointValues>) => {
		onEndpointChange({ ...endpoint, ...patch });
	};

	const onSelectValue = (value: string) => {
		if (value === MANUAL) {
			onSelect(null);
			onEndpointChange(emptyEndpointValues);
			return;
		}
		if (value === NEW_CONNECTION) {
			setNewDialogOpen(true);
			return;
		}
		const c = conns.get(value);
		if (c) {
			onSelect(c.id);
			onEndpointChange({
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
				setSaveError(e instanceof Error ? e.message : "");
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
			setSaveError(t("endpoint.nameRequired"));
			return;
		}
		try {
			const created = createConn({ name, ...endpoint });
			onSelect(created.id);
			setSaveOpen(false);
			setSaveName("");
		} catch (e) {
			const msg = e instanceof Error ? e.message : "";
			setSaveError(
				msg.toLowerCase().includes("exists") ? t("endpoint.nameExists") : msg,
			);
		}
	};

	const onParseCurl = () => {
		const parsed = parseCurlCommand(curlText);
		if (!parsed.url && !parsed.body) {
			setCurlFeedback(t("endpoint.filled", { fields: "—" }));
			return;
		}
		const filled: string[] = [];
		const next: EndpointValues = { ...endpoint };
		if (parsed.url) {
			next.apiUrl = parsed.url;
			filled.push("apiUrl");
		}
		if (parsed.queryParams) {
			next.queryParams = parsed.queryParams;
			filled.push("queryParams");
		}
		const auth = parsed.headers.authorization;
		if (auth) {
			const key = auth.value.replace(/^Bearer\s+/i, "").trim();
			if (key) {
				next.apiKey = key;
				filled.push("apiKey");
			}
		}
		const customLines: string[] = [];
		for (const [lower, entry] of Object.entries(parsed.headers)) {
			if (lower === "authorization" || lower === "content-type") continue;
			customLines.push(`${entry.originalKey}: ${entry.value}`);
		}
		if (customLines.length) {
			next.customHeaders = customLines.join("\n");
			filled.push("customHeaders");
		}
		const body = parsed.body as Record<string, unknown> | null;
		if (body && typeof body.model === "string") {
			next.model = body.model;
			filled.push("model");
		}
		// Parsing a curl moves us off any saved connection.
		onSelect(null);
		onEndpointChange(next);
		onCurlParsed?.(parsed);

		setCurlFeedback(t("endpoint.filled", { fields: filled.join(", ") }));
		setCurlText("");
		setTimeout(() => {
			setCurlOpen(false);
			setCurlFeedback(null);
		}, 1200);
	};

	return (
		<div className="space-y-3">
			<div className="flex flex-nowrap items-center justify-end gap-2 overflow-x-auto">
				<Select
					value={selectedConnectionId ?? MANUAL}
					onValueChange={onSelectValue}
				>
					<SelectTrigger className="h-9 min-w-[200px] text-xs">
						<SelectValue placeholder={t("endpoint.loadFromSaved")} />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={MANUAL}>{t("endpoint.manual")}</SelectItem>
						{connectionList.map((c) => (
							<SelectItem key={c.id} value={c.id}>
								{c.name}
							</SelectItem>
						))}
						<SelectSeparator />
						<SelectItem value={NEW_CONNECTION}>
							{t("endpoint.newConnection")}
						</SelectItem>
					</SelectContent>
				</Select>
				{isDirty ? (
					<span
						className="h-2 w-2 shrink-0 rounded-full bg-warning"
						title={t("endpoint.modified")}
						aria-label={t("endpoint.modified")}
					/>
				) : null}
				<Button
					type="button"
					size="sm"
					variant="outline"
					onClick={onSaveClick}
					disabled={!canSave}
					className="shrink-0"
				>
					{selectedConn ? t("endpoint.save") : t("endpoint.saveAs")}
				</Button>
				<Button
					type="button"
					size="sm"
					variant="outline"
					onClick={() => {
						setCurlOpen((v) => !v);
						setCurlFeedback(null);
					}}
					className="shrink-0"
				>
					<ClipboardPaste className="h-3.5 w-3.5" />
					<span className="ml-1">{t("endpoint.pasteCurl")}</span>
				</Button>
			</div>

			{curlOpen ? (
				<div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
					<Textarea
						rows={5}
						value={curlText}
						onChange={(e) => setCurlText(e.target.value)}
						placeholder={t("endpoint.curlPlaceholder")}
						className="font-mono text-xs"
					/>
					<div className="flex items-center gap-2">
						<Button
							type="button"
							size="sm"
							onClick={onParseCurl}
							disabled={!curlText.trim()}
						>
							{t("endpoint.parseCurl")}
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
							{t("actions.cancel")}
						</Button>
						{curlFeedback ? (
							<span className="text-xs text-success">{curlFeedback}</span>
						) : null}
					</div>
				</div>
			) : null}

			<ConnectionDialog
				open={newDialogOpen}
				onOpenChange={setNewDialogOpen}
				onSaved={(c) => {
					onSelect(c.id);
					onEndpointChange({
						apiUrl: c.apiUrl,
						apiKey: c.apiKey,
						model: c.model,
						customHeaders: c.customHeaders,
						queryParams: c.queryParams,
					});
				}}
			/>

			{saveOpen ? (
				<div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-2">
					<Input
						value={saveName}
						onChange={(e) => setSaveName(e.target.value)}
						placeholder={t("endpoint.nameConnection")}
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
						{t("actions.cancel")}
					</Button>
					<Button type="button" size="sm" onClick={onSaveAsSubmit}>
						{t("actions.save")}
					</Button>
					{saveError ? (
						<span className="text-xs text-destructive">{saveError}</span>
					) : null}
				</div>
			) : null}

			<section className="rounded-lg border border-border bg-card p-4">
				<h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
					{t("endpoint.label")}
				</h2>
				<div className="space-y-3">
					<div>
						<Label>{t("endpoint.apiUrl")}</Label>
						<Input
							value={endpoint.apiUrl}
							onChange={(e) => patchEndpoint({ apiUrl: e.target.value })}
							placeholder="http://host:port/v1/chat/completions"
							className="font-mono text-xs"
						/>
					</div>
					<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
						<div>
							<Label>{t("endpoint.apiKey")}</Label>
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
							<Label>{t("endpoint.model")}</Label>
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
							{t("endpoint.advanced")}
						</summary>
						<div className="mt-2 space-y-3">
							<div>
								<Label>{t("endpoint.customHeaders")}</Label>
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
								<Label>{t("endpoint.queryParams")}</Label>
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
			</section>
		</div>
	);
}

export { emptyEndpointValues };
export type { EndpointValues };
