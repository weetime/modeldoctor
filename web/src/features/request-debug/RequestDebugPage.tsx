import { PageHeader } from "@/components/common/page-header";
import { useTranslation } from "react-i18next";

export function RequestDebugPage() {
	const { t } = useTranslation("sidebar");
	return (
		<>
			<PageHeader title={t("items.requestDebug")} />
			<div className="px-8 py-10 text-sm text-muted-foreground">
				Phase 4 will replace this stub with the Request Debug interface.
			</div>
		</>
	);
}
