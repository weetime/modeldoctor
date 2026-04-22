import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Trash2 } from "lucide-react";
import type { KeyValueRow } from "./types";

interface Props {
	rows: KeyValueRow[];
	onChange: (rows: KeyValueRow[]) => void;
}

export function KeyValueTable({ rows, onChange }: Props) {
	const update = (i: number, patch: Partial<KeyValueRow>) => {
		const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
		onChange(next);
	};
	const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
	const add = () => onChange([...rows, { key: "", value: "", enabled: true }]);

	return (
		<div className="space-y-2">
			{rows.map((r, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: rows are reordered by index; no stable id
				<div key={i} className="flex items-center gap-2">
					<Switch
						checked={r.enabled}
						onCheckedChange={(b) => update(i, { enabled: b })}
					/>
					<Input
						placeholder="key"
						value={r.key}
						onChange={(e) => update(i, { key: e.target.value })}
						className="font-mono text-xs"
					/>
					<Input
						placeholder="value"
						value={r.value}
						onChange={(e) => update(i, { value: e.target.value })}
						className="font-mono text-xs"
					/>
					<Button
						variant="ghost"
						size="icon"
						onClick={() => remove(i)}
						aria-label="remove"
					>
						<Trash2 className="h-4 w-4" />
					</Button>
				</div>
			))}
			<Button size="sm" variant="outline" onClick={add}>
				+ Row
			</Button>
		</div>
	);
}
