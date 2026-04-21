import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLoadTestStore } from "../store";

export function EmbeddingsForm() {
	const { t } = useTranslation("load-test");
	const v = useLoadTestStore((s) => s.embeddings);
	const patch = useLoadTestStore((s) => s.patch);
	const set = (next: Partial<typeof v>) => patch("embeddings", { ...v, ...next });
	return (
		<div className="grid grid-cols-2 gap-4">
			<div className="col-span-2">
				<Label>{t("fields.embeddingInput")}</Label>
				<Textarea
					rows={4}
					value={v.embeddingInput}
					onChange={(e) => set({ embeddingInput: e.target.value })}
				/>
			</div>
		</div>
	);
}
