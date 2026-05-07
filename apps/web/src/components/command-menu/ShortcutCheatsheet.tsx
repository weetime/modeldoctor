import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { useTranslation } from "react-i18next";

interface ShortcutCheatsheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform);
const cmdKey = isMac ? "⌘" : "Ctrl";

interface Row {
  keys: readonly string[];
  labelKey: string;
}

const rows: Row[] = [
  { keys: [cmdKey, "K"], labelKey: "rows.commandMenu" },
  { keys: ["?"], labelKey: "rows.help" },
  { keys: ["Esc"], labelKey: "rows.close" },
];

export function ShortcutCheatsheet({ open, onOpenChange }: ShortcutCheatsheetProps) {
  const { t } = useTranslation("commands");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("help.title")}</DialogTitle>
          <DialogDescription>{t("help.description")}</DialogDescription>
        </DialogHeader>
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.labelKey} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t(row.labelKey)}</span>
              <span className="flex items-center gap-1">
                {row.keys.map((k, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static row, keys are stable
                  <Kbd key={i}>{k}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
