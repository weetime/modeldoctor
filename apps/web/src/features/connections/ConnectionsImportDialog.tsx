import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { useConnectionsStore } from "@/stores/connections-store";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConnectionsImportDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation("connections");
  const { t: tc } = useTranslation("common");
  const importAll = useConnectionsStore((s) => s.importAll);
  const [json, setJson] = useState("");
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    added: number;
    skipped: number;
  } | null>(null);

  const onSubmit = () => {
    setError(null);
    setResult(null);
    try {
      const r = importAll(json, mode);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("import.invalid"));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setJson("");
          setError(null);
          setResult(null);
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("import.title")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t("import.body")}</p>

        <div>
          <Label htmlFor="import-file" className="text-sm">
            {tc("actions.import")} (file)
          </Label>
          <input
            id="import-file"
            type="file"
            accept="application/json,.json"
            className="block w-full text-sm"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) setJson(await file.text());
            }}
          />
        </div>

        <Textarea
          rows={8}
          className="font-mono text-xs"
          placeholder='{"version":1,"connections":[…]}'
          value={json}
          onChange={(e) => setJson(e.target.value)}
        />

        <div>
          <Label className="text-sm">{t("import.mode")}</Label>
          <RadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as "merge" | "replace")}
            className="mt-2"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem id="m-merge" value="merge" />
              <Label htmlFor="m-merge" className="font-normal">
                {t("import.merge")}
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem id="m-replace" value="replace" />
              <Label htmlFor="m-replace" className="font-normal">
                {t("import.replace")}
              </Label>
            </div>
          </RadioGroup>
        </div>

        {result ? (
          <p className="text-sm text-success">
            {t("import.result", {
              added: result.added,
              skipped: result.skipped,
            })}
          </p>
        ) : null}
        {error ? <p className="text-sm text-destructive">{t("import.invalid")}</p> : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {tc("actions.cancel")}
          </Button>
          <Button onClick={onSubmit} disabled={!json.trim()}>
            {t("import.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
