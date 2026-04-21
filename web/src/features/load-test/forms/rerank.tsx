import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "react-i18next";
import { useLoadTestStore } from "../store";

export function RerankForm() {
	const { t } = useTranslation("load-test");
	const v = useLoadTestStore((s) => s.rerank);
	const patch = useLoadTestStore((s) => s.patch);
	const set = (next: Partial<typeof v>) => patch("rerank", { ...v, ...next });
	return (
		<div className="grid grid-cols-2 gap-4">
			<div className="col-span-2">
				<Label>{t("fields.rerankQuery")}</Label>
				<Input
					value={v.rerankQuery}
					onChange={(e) => set({ rerankQuery: e.target.value })}
				/>
			</div>
			<div className="col-span-2">
				<Label>{t("fields.rerankTexts")}</Label>
				<Textarea
					rows={4}
					value={v.rerankTexts}
					onChange={(e) => set({ rerankTexts: e.target.value })}
				/>
			</div>
		</div>
	);
}
