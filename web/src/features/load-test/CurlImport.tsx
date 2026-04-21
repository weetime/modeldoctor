import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { detectApiType, parseCurlCommand } from "@/lib/curl-parser";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLoadTestStore } from "./store";
import type { ApiType } from "./types";

/** Extract first string user-prompt from an OpenAI-shape messages array. */
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

/** Pull out the first image URL from a multimodal `content` array. */
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

export function CurlImport() {
	const { t } = useTranslation("load-test");
	const setApiType = useLoadTestStore((s) => s.setApiType);
	const setSelected = useLoadTestStore((s) => s.setSelected);
	const patch = useLoadTestStore((s) => s.patch);
	const curlInput = useLoadTestStore((s) => s.curlInput);
	const manualEndpoint = useLoadTestStore((s) => s.manualEndpoint);
	const chat = useLoadTestStore((s) => s.chat);
	const embeddings = useLoadTestStore((s) => s.embeddings);
	const rerank = useLoadTestStore((s) => s.rerank);
	const images = useLoadTestStore((s) => s.images);
	const chatVision = useLoadTestStore((s) => s.chatVision);
	const chatAudio = useLoadTestStore((s) => s.chatAudio);
	const [feedback, setFeedback] = useState<string | null>(null);

	const onParse = () => {
		const parsed = parseCurlCommand(curlInput);
		const filled: string[] = [];

		if (!parsed.url && !parsed.body) {
			setFeedback(t("curl.filled", { fields: "—" }));
			patch("curlInput", curlInput);
			return;
		}

		const detected: ApiType = detectApiType(parsed.url, parsed.body);
		setApiType(detected);
		filled.push(`type=${detected}`);

		// Switch to Manual mode and populate endpoint fields from the curl.
		setSelected(null);
		const nextManual = { ...manualEndpoint };
		if (parsed.url) {
			nextManual.apiUrl = parsed.url;
			filled.push("apiUrl");
		}
		if (parsed.queryParams) {
			nextManual.queryParams = parsed.queryParams;
			filled.push("queryParams");
		}
		const auth = parsed.headers.authorization;
		if (auth) {
			const key = auth.value.replace(/^Bearer\s+/i, "").trim();
			if (key) {
				nextManual.apiKey = key;
				filled.push("apiKey");
			}
		}
		const customLines: string[] = [];
		for (const [lower, entry] of Object.entries(parsed.headers)) {
			if (lower === "authorization" || lower === "content-type") continue;
			customLines.push(`${entry.originalKey}: ${entry.value}`);
		}
		if (customLines.length) {
			nextManual.customHeaders = customLines.join("\n");
			filled.push("customHeaders");
		}
		const body = parsed.body as Record<string, unknown> | null;
		if (body && typeof body.model === "string") {
			nextManual.model = body.model;
			filled.push("model");
		}
		patch("manualEndpoint", nextManual);

		if (detected === "chat" && body) {
			const prompt = extractUserPrompt(body.messages);
			if (prompt != null) {
				patch("chat", { ...chat, prompt });
				filled.push("prompt");
			}
			if (typeof body.max_tokens === "number") {
				patch("chat", { ...chat, maxTokens: body.max_tokens });
				filled.push("maxTokens");
			}
			if (typeof body.temperature === "number") {
				patch("chat", { ...chat, temperature: body.temperature });
				filled.push("temperature");
			}
			if (typeof body.stream === "boolean") {
				patch("chat", { ...chat, stream: body.stream });
				filled.push("stream");
			}
		}

		if (detected === "embeddings" && body) {
			const input = body.input;
			const text = Array.isArray(input)
				? input.filter((x) => typeof x === "string").join("\n")
				: typeof input === "string"
					? input
					: null;
			if (text) {
				patch("embeddings", { ...embeddings, embeddingInput: text });
				filled.push("input");
			}
		}

		if (detected === "rerank" && body) {
			const nextRerank = { ...rerank };
			if (typeof body.query === "string") {
				nextRerank.rerankQuery = body.query;
				filled.push("query");
			}
			if (Array.isArray(body.texts)) {
				nextRerank.rerankTexts = body.texts
					.filter((x) => typeof x === "string")
					.join("\n");
				filled.push("texts");
			}
			patch("rerank", nextRerank);
		}

		if (detected === "images" && body) {
			const nextImages = { ...images };
			if (typeof body.prompt === "string") {
				nextImages.imagePrompt = body.prompt;
				filled.push("prompt");
			}
			if (typeof body.size === "string") {
				nextImages.imageSize = body.size;
				filled.push("size");
			}
			if (typeof body.n === "number") {
				nextImages.imageN = body.n;
				filled.push("n");
			}
			patch("images", nextImages);
		}

		if (detected === "chat-vision" && body) {
			const nextVision = { ...chatVision };
			const imageUrl = extractImageUrl(body.messages);
			if (imageUrl) {
				nextVision.imageUrl = imageUrl;
				filled.push("imageUrl");
			}
			const prompt = extractUserPrompt(body.messages);
			if (prompt) {
				nextVision.prompt = prompt;
				filled.push("prompt");
			}
			const sys = extractSystemPrompt(body.messages);
			if (sys) {
				nextVision.systemPrompt = sys;
				filled.push("systemPrompt");
			}
			if (typeof body.max_tokens === "number") {
				nextVision.maxTokens = body.max_tokens;
				filled.push("maxTokens");
			}
			if (typeof body.temperature === "number") {
				nextVision.temperature = body.temperature;
				filled.push("temperature");
			}
			patch("chatVision", nextVision);
		}

		if (detected === "chat-audio" && body) {
			const nextAudio = { ...chatAudio };
			const prompt = extractUserPrompt(body.messages);
			if (prompt) {
				nextAudio.prompt = prompt;
				filled.push("prompt");
			}
			const sys = extractSystemPrompt(body.messages);
			if (sys) {
				nextAudio.systemPrompt = sys;
				filled.push("systemPrompt");
			}
			patch("chatAudio", nextAudio);
		}

		setFeedback(t("curl.filled", { fields: filled.join(", ") }));
		patch("curlInput", curlInput);
	};

	return (
		<div className="space-y-2">
			<Textarea
				rows={5}
				value={curlInput}
				onChange={(e) => patch("curlInput", e.target.value)}
				placeholder={`curl http://example/v1/chat/completions \\\n  -H "Authorization: Bearer sk-\u2026" \\\n  -d '{...}'`}
				className="font-mono text-xs"
			/>
			<div className="flex items-center gap-2">
				<Button type="button" size="sm" onClick={onParse}>
					{t("curl.parse")}
				</Button>
				{feedback ? (
					<span className="text-xs text-success">{feedback}</span>
				) : null}
			</div>
		</div>
	);
}
