import { PageHeader } from "@/components/common/page-header";
import { useTranslation } from "react-i18next";

export function ConnectionsPage() {
	const { t } = useTranslation("sidebar");
	return (
		<>
			<PageHeader title={t("items.connections")} />
			<div className="px-8 py-10 text-sm text-muted-foreground">
				Phase 3 will replace this stub with the Connections library.
			</div>
		</>
	);
}
