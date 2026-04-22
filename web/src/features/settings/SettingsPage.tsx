import { PageHeader } from "@/components/common/page-header";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { ConnectionsImportDialog } from "@/features/connections/ConnectionsImportDialog";
import { api } from "@/lib/api-client";
import { useConnectionsStore } from "@/stores/connections-store";
import { type Locale, useLocaleStore } from "@/stores/locale-store";
import { type ThemeMode, useThemeStore } from "@/stores/theme-store";
import { format } from "date-fns";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export function SettingsPage() {
	const { t } = useTranslation("settings");
	const { t: tc } = useTranslation("common");
	const theme = useThemeStore((s) => s.mode);
	const setTheme = useThemeStore((s) => s.setMode);
	const locale = useLocaleStore((s) => s.locale);
	const setLocale = useLocaleStore((s) => s.setLocale);
	const exportAll = useConnectionsStore((s) => s.exportAll);
	const [importOpen, setImportOpen] = useState(false);
	const [resetOpen, setResetOpen] = useState(false);

	const [vegeta, setVegeta] = useState<{
		installed: boolean;
		path?: string;
	} | null>(null);

	const onExport = () => {
		const blob = new Blob([exportAll()], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `modeldoctor-connections-${format(new Date(), "yyyy-MM-dd")}.json`;
		a.click();
		URL.revokeObjectURL(url);
	};

	const onCheckVegeta = async () => {
		try {
			const data = await api.get<{ installed: boolean; path?: string }>(
				"/api/check-vegeta",
			);
			setVegeta(data);
		} catch {
			setVegeta({ installed: false });
		}
	};

	const onResetAll = () => {
		for (const k of Object.keys(localStorage).filter((k) =>
			k.startsWith("md."),
		)) {
			localStorage.removeItem(k);
		}
		window.location.reload();
	};

	return (
		<>
			<PageHeader title={t("title")} subtitle={t("subtitle")} />
			<div className="space-y-6 px-8 py-6">
				<Section title={t("appearance.title")}>
					<div className="space-y-4">
						<div>
							<Label>{t("appearance.theme")}</Label>
							<RadioGroup
								value={theme}
								onValueChange={(v) => setTheme(v as ThemeMode)}
								className="mt-2 flex gap-4"
							>
								{(["light", "dark", "system"] as ThemeMode[]).map((m) => (
									<div key={m} className="flex items-center gap-2">
										<RadioGroupItem id={`th-${m}`} value={m} />
										<Label htmlFor={`th-${m}`} className="font-normal">
											{t(`appearance.themeOptions.${m}`)}
										</Label>
									</div>
								))}
							</RadioGroup>
						</div>
						<div>
							<Label>{t("appearance.language")}</Label>
							<Select
								value={locale}
								onValueChange={(v) => setLocale(v as Locale)}
							>
								<SelectTrigger className="mt-2 max-w-[180px]">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="en-US">
										{t("appearance.languages.en")}
									</SelectItem>
									<SelectItem value="zh-CN">
										{t("appearance.languages.zh")}
									</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>
				</Section>

				<Section title={t("environment.title")}>
					<div className="space-y-4 text-sm">
						<div>
							<div className="font-medium">{t("environment.vegeta")}</div>
							<div className="mt-2 flex items-center gap-2">
								<Button size="sm" variant="outline" onClick={onCheckVegeta}>
									{t("environment.vegetaCheck")}
								</Button>
								{vegeta?.installed ? (
									<span className="text-success">
										{t("environment.vegetaInstalled", { path: vegeta.path })}
									</span>
								) : null}
								{vegeta && !vegeta.installed ? (
									<span className="text-destructive">
										{t("environment.vegetaMissing")}{" "}
										<code className="ml-1 rounded bg-muted px-1 font-mono text-xs">
											brew install vegeta
										</code>
									</span>
								) : null}
							</div>
						</div>
						<div className="text-muted-foreground">
							{t("environment.buildMode")}:{" "}
							<span className="font-mono">{import.meta.env.MODE}</span>
						</div>
					</div>
				</Section>

				<Section title={t("data.title")}>
					<div className="flex flex-wrap gap-2">
						<Button variant="outline" size="sm" onClick={onExport}>
							{t("data.exportConnections")}
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => setImportOpen(true)}
						>
							{t("data.importConnections")}
						</Button>
						<Button
							variant="destructive"
							size="sm"
							onClick={() => setResetOpen(true)}
						>
							{t("data.resetState")}
						</Button>
					</div>
				</Section>
			</div>

			<ConnectionsImportDialog open={importOpen} onOpenChange={setImportOpen} />
			<AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t("data.resetState")}</AlertDialogTitle>
						<AlertDialogDescription>
							{t("data.resetWarning")}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
						<AlertDialogAction onClick={onResetAll}>
							{t("data.resetConfirm")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

function Section({
	title,
	children,
}: { title: string; children: React.ReactNode }) {
	return (
		<section className="rounded-lg border border-border bg-card p-4">
			<h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
				{title}
			</h2>
			{children}
		</section>
	);
}
