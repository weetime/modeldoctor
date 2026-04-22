import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle2, Copy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MetricsGrid } from "./MetricsGrid";
import type { LoadTestResult } from "./types";

interface Props {
	result: LoadTestResult | null;
	error: string | null;
}

function CopyBlock({ label, text }: { label: string; text: string }) {
	const { t } = useTranslation("common");
	const [copied, setCopied] = useState(false);
	return (
		<div className="rounded-lg border border-border bg-muted/40">
			<div className="flex items-center justify-between border-b border-border px-3 py-1.5">
				<span className="text-xs font-medium text-muted-foreground">
					{label}
				</span>
				<Button
					variant="ghost"
					size="sm"
					onClick={async () => {
						await navigator.clipboard.writeText(text);
						setCopied(true);
						setTimeout(() => setCopied(false), 1500);
					}}
				>
					<Copy className="h-3 w-3" />
					<span className="ml-1 text-xs">
						{copied ? t("actions.copied") : t("actions.copy")}
					</span>
				</Button>
			</div>
			<pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed">
				{text}
			</pre>
		</div>
	);
}

export function LoadTestResults({ result, error }: Props) {
	const { t } = useTranslation("load-test");
	if (error) {
		return (
			<Alert variant="destructive" className="mt-4">
				<AlertCircle className="h-4 w-4" />
				<AlertDescription>{t("alerts.failure", { error })}</AlertDescription>
			</Alert>
		);
	}
	if (!result) return null;
	return (
		<div className="mt-4 space-y-4">
			<Alert>
				<CheckCircle2 className="h-4 w-4" />
				<AlertDescription>{t("alerts.success")}</AlertDescription>
			</Alert>
			<MetricsGrid parsed={result.parsed} />
			<CopyBlock label={t("raw")} text={result.report} />
			<CopyBlock
				label={t("config")}
				text={JSON.stringify(result.config, null, 2)}
			/>
		</div>
	);
}
