import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLoadTestStore } from "../store";

export function ChatVisionForm() {
	const { t } = useTranslation("load-test");
	const v = useLoadTestStore((s) => s.chatVision);
	const patch = useLoadTestStore((s) => s.patch);
	const set = (next: Partial<typeof v>) => patch("chatVision", { ...v, ...next });
	return (
		<div className="grid grid-cols-2 gap-4">
			<div className="col-span-2">
				<Label>{t("fields.imageUrl")}</Label>
				<Input
					value={v.imageUrl}
					onChange={(e) => set({ imageUrl: e.target.value })}
				/>
			</div>
			<div className="col-span-2">
				<Label>{t("fields.prompt")}</Label>
				<Textarea
					rows={4}
					value={v.prompt}
					onChange={(e) => set({ prompt: e.target.value })}
				/>
			</div>
			<div className="col-span-2">
				<Label>{t("fields.systemPrompt")}</Label>
				<Textarea
					rows={2}
					value={v.systemPrompt}
					onChange={(e) => set({ systemPrompt: e.target.value })}
				/>
			</div>
			<div>
				<Label>{t("fields.maxTokens")}</Label>
				<Input
					type="number"
					value={v.maxTokens}
					onChange={(e) => set({ maxTokens: Number(e.target.value) })}
				/>
			</div>
			<div>
				<Label>{t("fields.temperature")}</Label>
				<Input
					type="number"
					step="0.1"
					value={v.temperature}
					onChange={(e) => set({ temperature: Number(e.target.value) })}
				/>
			</div>
		</div>
	);
}
