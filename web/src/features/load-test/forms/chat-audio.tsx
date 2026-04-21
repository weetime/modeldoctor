import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLoadTestStore } from "../store";

export function ChatAudioForm() {
	const { t } = useTranslation("load-test");
	const v = useLoadTestStore((s) => s.chatAudio);
	const patch = useLoadTestStore((s) => s.patch);
	const set = (next: Partial<typeof v>) => patch("chatAudio", { ...v, ...next });
	return (
		<div className="grid grid-cols-2 gap-4">
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
		</div>
	);
}
