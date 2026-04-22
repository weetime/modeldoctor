import type { EndpointValues } from "@/types/connection";
import type { ParsedCurl } from "./curl-parser";

export type EndpointKey = keyof EndpointValues;

export interface CurlToEndpointResult {
	/** Partial patch to apply to an EndpointValues. Empty if nothing matched. */
	patch: Partial<EndpointValues>;
	/** Which endpoint fields were populated, in detection order. */
	filledKeys: EndpointKey[];
}

/**
 * Derive an EndpointValues patch from a parsed cURL invocation.
 *
 * Pure function — callers decide how to apply the patch (react-hook-form
 * setValue, controlled setState, or direct store patch) and how to surface
 * the `filledKeys` summary to the user.
 */
export function applyCurlToEndpoint(parsed: ParsedCurl): CurlToEndpointResult {
	const patch: Partial<EndpointValues> = {};
	const filledKeys: EndpointKey[] = [];

	if (parsed.url) {
		patch.apiUrl = parsed.url;
		filledKeys.push("apiUrl");
	}
	if (parsed.queryParams) {
		patch.queryParams = parsed.queryParams;
		filledKeys.push("queryParams");
	}

	const auth = parsed.headers.authorization;
	if (auth) {
		const key = auth.value.replace(/^Bearer\s+/i, "").trim();
		if (key) {
			patch.apiKey = key;
			filledKeys.push("apiKey");
		}
	}

	const customLines: string[] = [];
	for (const [lower, entry] of Object.entries(parsed.headers)) {
		if (lower === "authorization" || lower === "content-type") continue;
		customLines.push(`${entry.originalKey}: ${entry.value}`);
	}
	if (customLines.length) {
		patch.customHeaders = customLines.join("\n");
		filledKeys.push("customHeaders");
	}

	const body = parsed.body as Record<string, unknown> | null;
	if (body && typeof body.model === "string") {
		patch.model = body.model;
		filledKeys.push("model");
	}

	return { patch, filledKeys };
}
