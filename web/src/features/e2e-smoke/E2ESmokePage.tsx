import { PageHeader } from "@/components/common/page-header";
import { useTranslation } from "react-i18next";

export function E2ESmokePage() {
	const { t } = useTranslation("sidebar");
	return (
		<>
			<PageHeader title={t("items.e2e")} />
			<div className="px-8 py-10 text-sm text-muted-foreground">
				Phase 4 will replace this stub with the E2E Smoke probe cards.
			</div>
		</>
	);
}
