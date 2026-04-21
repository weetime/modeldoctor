import { PageHeader } from "@/components/common/page-header";
import { useTranslation } from "react-i18next";

export function SettingsPage() {
	const { t } = useTranslation("sidebar");
	return (
		<>
			<PageHeader title={t("items.settings")} />
			<div className="px-8 py-10 text-sm text-muted-foreground">
				Phase 5 will replace this stub with the Settings sections.
			</div>
		</>
	);
}
