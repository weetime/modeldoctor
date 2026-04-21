import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { detectApiType, parseCurlCommand } from "@/lib/curl-parser";
import { useLoadTestStore } from "./store";
import type { ApiType } from "./types";

export function CurlImport() {
	const { t } = useTranslation("load-test");
	const setApiType = useLoadTestStore((s) => s.setApiType);
	const patch = useLoadTestStore((s) => s.patch);
	const curlInput = useLoadTestStore((s) => s.curlInput);
	const [feedback, setFeedback] = useState<string | null>(null);

	const onParse = () => {
		const parsed = parseCurlCommand(curlInput);
		const filled: string[] = [];
		if (parsed.url || parsed.body) {
			const detected: ApiType = detectApiType(parsed.url, parsed.body);
			setApiType(detected);
			filled.push(`type=${detected}`);
		}
		if (parsed.body) {
			if (parsed.body.model) filled.push("model");
			// Parameter-specific fields are populated by the targeted form components
			// when apiType matches; here we only set apiType + record what was found.
		}
		setFeedback(t("curl.filled", { fields: filled.join(", ") }));
		// Persist the curl input so user can re-parse after navigation
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
				{feedback ? <span className="text-xs text-success">{feedback}</span> : null}
			</div>
		</div>
	);
}
