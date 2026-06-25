import { Pencil } from "lucide-react";
import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";

/**
 * Click-to-edit text cell for dense list tables: renders the value as a button
 * (pencil affordance on hover); clicking swaps in an input. Enter / blur commits
 * (only when changed), Escape cancels. An empty `value` shows `placeholder`.
 * Distinct from the Compare matrix's always-on input — a list of many rows must
 * not show inputs everywhere.
 */
export function ClickToEditCell({
  value,
  onCommit,
  ariaLabel,
  placeholder,
}: {
  value: string;
  onCommit: (next: string) => void;
  ariaLabel: string;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const skipBlur = useRef(false);

  if (editing) {
    const commit = () => {
      setEditing(false);
      if (draft !== value) onCommit(draft);
    };
    return (
      <Input
        ref={(el) => el?.focus()}
        value={draft}
        aria-label={ariaLabel}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (skipBlur.current) {
            skipBlur.current = false;
            return;
          }
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            skipBlur.current = true;
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            skipBlur.current = true;
            setEditing(false);
          }
        }}
        className="h-8 max-w-[16rem]"
      />
    );
  }
  return (
    <button
      type="button"
      title={ariaLabel}
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      className="group inline-flex items-center gap-1 rounded-sm text-left hover:text-primary"
    >
      <span className={value ? "" : "text-muted-foreground"}>{value || placeholder}</span>
      <Pencil className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
    </button>
  );
}
