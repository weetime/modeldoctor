import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
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
import { ChevronDown, MoreHorizontal, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

const MANUAL = "__manual__";

export interface EndpointSelectorProps {
	selectedId: string | null;
	/** When true, shows a small dot indicating the current endpoint differs from the loaded connection. */
	modified?: boolean;
	onSelect: (id: string | null) => void;
}

/**
 * Compact connection picker intended for a page header / toolbar slot when the
 * endpoint form itself is not visible. Shows the dropdown, a modified dot,
 * a "+" to create a new connection, and a kebab menu with a link to the
 * connections library.
 *
 * **When to use:** pages where the endpoint is incidental (e.g. Request
 * Debug's top-right slot).
 *
 * **When NOT to use:** pages where the user edits API URL / Key / Model
 * inline — use {@link EndpointPicker} embedded in the page body instead.
 * Save / Save-as-new live on the picker because only it has the current
 * form values to persist.
 */
export function EndpointSelector({
	selectedId,
	modified,
	onSelect,
}: EndpointSelectorProps) {
	const { t } = useTranslation("common");
	const navigate = useNavigate();
	const list = useConnectionsStore((s) => s.list());
	const [createOpen, setCreateOpen] = useState(false);

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
		</div>
	);
}
