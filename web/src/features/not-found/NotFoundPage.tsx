import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

export function NotFoundPage() {
	const { t } = useTranslation("common");
	return (
		<div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
			<h1 className="text-3xl font-semibold tracking-tight">404</h1>
			<p className="text-sm text-muted-foreground">Page not found.</p>
			<Button asChild variant="outline" size="sm">
				<Link to="/load-test">{t("comingSoon.backToLoadTest")}</Link>
			</Button>
		</div>
	);
}
