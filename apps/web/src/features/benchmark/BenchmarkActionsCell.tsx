import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BenchmarkRunSummary } from "@modeldoctor/contracts";
import { MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { TERMINAL_STATES } from "./queries";

interface Props {
  run: BenchmarkRunSummary;
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
}

export function BenchmarkActionsCell({ run, onCancel, onDelete }: Props) {
  const { t } = useTranslation("benchmark");
  const navigate = useNavigate();
  const isTerminal = (TERMINAL_STATES as readonly string[]).includes(run.state);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Actions for ${run.name}`}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => navigate(`/benchmarks/${run.id}`)}>
          {t("actions.openDetail")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate(`/benchmarks?duplicate=${run.id}`)}>
          {t("actions.duplicate")}
        </DropdownMenuItem>
        {!isTerminal && (
          <DropdownMenuItem onClick={() => onCancel(run.id)}>
            {t("actions.cancel")}
          </DropdownMenuItem>
        )}
        {isTerminal && (
          <DropdownMenuItem
            onClick={() => onDelete(run.id)}
            className="text-destructive focus:text-destructive"
          >
            {t("actions.delete")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
