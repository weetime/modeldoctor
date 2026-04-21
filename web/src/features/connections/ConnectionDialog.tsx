import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useConnectionsStore } from "@/stores/connections-store";
import type { Connection } from "@/types/connection";
import { type ConnectionInput, connectionInputSchema } from "./schema";

interface ConnectionDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	connection?: Connection; // undefined → create mode
	onSaved?: (c: Connection) => void;
}

const empty: ConnectionInput = {
	name: "",
	apiUrl: "",
	apiKey: "",
	model: "",
	customHeaders: "",
	queryParams: "",
};

export function ConnectionDialog({
	open,
	onOpenChange,
	connection,
	onSaved,
}: ConnectionDialogProps) {
	const { t } = useTranslation("connections");
	const { t: tc } = useTranslation("common");
	const create = useConnectionsStore((s) => s.create);
	const update = useConnectionsStore((s) => s.update);
	const [revealKey, setRevealKey] = useState(false);
	const [submitError, setSubmitError] = useState<string | null>(null);

	const form = useForm<ConnectionInput>({
		resolver: zodResolver(connectionInputSchema),
		defaultValues: empty,
	});

	useEffect(() => {
		if (open) {
			form.reset(connection ?? empty);
			setSubmitError(null);
			setRevealKey(false);
		}
	}, [open, connection, form]);

	const onSubmit = form.handleSubmit((values) => {
		try {
			const saved = connection ? update(connection.id, values) : create(values);
			onSaved?.(saved);
			onOpenChange(false);
		} catch (e) {
			const msg = e instanceof Error ? e.message : tc("errors.unknown");
			setSubmitError(msg);
		}
	});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>
						{connection ? t("dialog.editTitle") : t("dialog.createTitle")}
					</DialogTitle>
				</DialogHeader>

				<form onSubmit={onSubmit} className="space-y-4">
					<div>
						<Label htmlFor="name">{t("dialog.fields.name")}</Label>
						<Input
							id="name"
							autoComplete="off"
							placeholder={t("dialog.fields.namePlaceholder")}
							{...form.register("name")}
						/>
						{form.formState.errors.name ? (
							<p className="mt-1 text-xs text-destructive">{tc("errors.required")}</p>
						) : null}
					</div>

					<div>
						<Label htmlFor="apiUrl">{t("dialog.fields.apiUrl")}</Label>
						<Input
							id="apiUrl"
							autoComplete="off"
							placeholder={t("dialog.fields.apiUrlPlaceholder")}
							{...form.register("apiUrl")}
						/>
						{form.formState.errors.apiUrl ? (
							<p className="mt-1 text-xs text-destructive">
								{t("dialog.errors.invalidUrl")}
							</p>
						) : null}
					</div>

					<div>
						<Label htmlFor="apiKey">{t("dialog.fields.apiKey")}</Label>
						<div className="relative">
							<Input
								id="apiKey"
								autoComplete="off"
								type={revealKey ? "text" : "password"}
								placeholder={t("dialog.fields.apiKeyPlaceholder")}
								{...form.register("apiKey")}
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
						{form.formState.errors.apiKey ? (
							<p className="mt-1 text-xs text-destructive">{tc("errors.required")}</p>
						) : null}
					</div>

					<div>
						<Label htmlFor="model">{t("dialog.fields.model")}</Label>
						<Input
							id="model"
							autoComplete="off"
							placeholder={t("dialog.fields.modelPlaceholder")}
							{...form.register("model")}
						/>
						{form.formState.errors.model ? (
							<p className="mt-1 text-xs text-destructive">{tc("errors.required")}</p>
						) : null}
					</div>

					<div>
						<Label htmlFor="customHeaders">{t("dialog.fields.customHeaders")}</Label>
						<Textarea
							id="customHeaders"
							rows={3}
							placeholder={t("dialog.fields.customHeadersPlaceholder")}
							{...form.register("customHeaders")}
						/>
					</div>

					<div>
						<Label htmlFor="queryParams">{t("dialog.fields.queryParams")}</Label>
						<Textarea
							id="queryParams"
							rows={2}
							placeholder={t("dialog.fields.queryParamsPlaceholder")}
							{...form.register("queryParams")}
						/>
					</div>

					{submitError ? (
						<p className="text-sm text-destructive">
							{submitError.toLowerCase().includes("exists")
								? t("dialog.errors.duplicateName")
								: submitError}
						</p>
					) : null}

					<DialogFooter>
						<Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
							{tc("actions.cancel")}
						</Button>
						<Button type="submit">{tc("actions.save")}</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
