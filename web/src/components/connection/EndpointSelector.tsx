import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { ConnectionDialog } from "@/features/connections/ConnectionDialog";
import { useConnectionsStore } from "@/stores/connections-store";
import type { Connection } from "@/types/connection";
import { ChevronDown, MoreHorizontal, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

const MANUAL = "__manual__";

export interface EndpointSelectorProps {
	selectedId: string | null;
	modified?: boolean;
	onSelect: (id: string | null) => void;
	onSaveCurrent?: () => void; // "Save" — write current form back to selected connection
	onSaveAsNew?: (name: string) => Connection;
}

export function EndpointSelector({
	selectedId,
	modified,
	onSelect,
	onSaveCurrent,
	onSaveAsNew,
}: EndpointSelectorProps) {
	const { t } = useTranslation("common");
	const navigate = useNavigate();
	const list = useConnectionsStore((s) => s.list());
	const [createOpen, setCreateOpen] = useState(false);
	const [namePromptOpen, setNamePromptOpen] = useState(false);
	const [draftName, setDraftName] = useState("");

	const currentValue = selectedId ?? MANUAL;

	return (
		<div className="flex items-center gap-2">
			<div className="flex items-center gap-1">
				<Select
					value={currentValue}
					onValueChange={(v) => onSelect(v === MANUAL ? null : v)}
				>
					<SelectTrigger className="h-8 min-w-[180px] text-xs">
						<SelectValue placeholder={t("endpoint.label")} />
						<ChevronDown className="h-3 w-3 opacity-60" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={MANUAL}>{t("endpoint.manual")}</SelectItem>
						{list.map((c) => (
							<SelectItem key={c.id} value={c.id}>
								{c.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{modified ? (
					<span
						aria-label={t("endpoint.modified")}
						title={t("endpoint.modified")}
						className="h-2 w-2 rounded-full bg-warning"
					/>
				) : null}
			</div>

			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" size="icon" aria-label="more">
						<MoreHorizontal className="h-4 w-4" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem
						disabled={!selectedId || !modified || !onSaveCurrent}
						onClick={() => onSaveCurrent?.()}
					>
						{t("actions.save")}
					</DropdownMenuItem>
					<DropdownMenuItem
						disabled={!onSaveAsNew}
						onClick={() => {
							setDraftName("");
							setNamePromptOpen(true);
						}}
					>
						{t("actions.saveAsNew")}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem onClick={() => navigate("/connections")}>
						{t("actions.manageConnections")}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<Button
				variant="outline"
				size="icon"
				onClick={() => setCreateOpen(true)}
				aria-label="new connection"
			>
				<Plus className="h-4 w-4" />
			</Button>
			<ConnectionDialog
				open={createOpen}
				onOpenChange={setCreateOpen}
				onSaved={(c) => onSelect(c.id)}
			/>

			{namePromptOpen ? (
				<NamePrompt
					value={draftName}
					onChange={setDraftName}
					onCancel={() => setNamePromptOpen(false)}
					onSubmit={() => {
						const created = onSaveAsNew?.(draftName.trim());
						if (created) onSelect(created.id);
						setNamePromptOpen(false);
					}}
				/>
			) : null}
		</div>
	);
}

function NamePrompt({
	value,
	onChange,
	onCancel,
	onSubmit,
}: {
	value: string;
	onChange: (v: string) => void;
	onCancel: () => void;
	onSubmit: () => void;
}) {
	return (
		<div className="absolute right-8 top-16 z-50 flex w-72 items-center gap-2 rounded-md border border-border bg-card p-2 shadow-md">
			<input
				// biome-ignore lint/a11y/noAutofocus: floating name prompt intentionally focuses for fast keyboard entry
				autoFocus
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder="connection-name"
				className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs"
			/>
			<Button size="sm" variant="ghost" onClick={onCancel}>
				Cancel
			</Button>
			<Button size="sm" onClick={onSubmit} disabled={!value.trim()}>
				Save
			</Button>
		</div>
	);
}
