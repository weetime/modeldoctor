import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, Copy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { CodeSnippets } from "./code-snippets/chat";

export interface ViewCodeDialogProps {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  snippets: CodeSnippets;
}

type Lang = "curl" | "python" | "node";
type View = "readable" | "full";

/** Estimate KB of base64 data from the size difference between full and readable. */
function estimateBase64Kb(snippets: CodeSnippets): number {
  const diff = snippets.curlFull.length - snippets.curlReadable.length;
  // base64 decode ratio: 4 chars → 3 bytes (≈0.75); used to estimate
  // the original binary size from the diff in encoded chars.
  return Math.round((diff * 0.75) / 1024);
}

function getSnippet(snippets: CodeSnippets, lang: Lang, view: View): string {
  if (lang === "curl") return view === "readable" ? snippets.curlReadable : snippets.curlFull;
  if (lang === "python") return view === "readable" ? snippets.pythonReadable : snippets.pythonFull;
  return view === "readable" ? snippets.nodeReadable : snippets.nodeFull;
}

export function ViewCodeDialog({ open, onOpenChange, snippets }: ViewCodeDialogProps) {
  const { t } = useTranslation("playground");
  const [active, setActive] = useState<Lang>("curl");
  const [view, setView] = useState<View>("readable");

  const hasBase64 =
    snippets.curlReadable !== snippets.curlFull ||
    snippets.pythonReadable !== snippets.pythonFull ||
    snippets.nodeReadable !== snippets.nodeFull;
  const kb = hasBase64 ? estimateBase64Kb(snippets) : 0;
  // showBase64Affordances: only show banner/toggle/dual copy when
  // truncation is substantial (>= 1 KB). For sub-1-KB payloads the
  // truncation helpers return readable === full, so this is always
  // consistent — kept explicit for clarity.
  const showBase64Affordances = hasBase64 && kb >= 1;

  const onCopy = async () => {
    const text = getSnippet(snippets, active, view);
    await navigator.clipboard.writeText(text);
    toast.success(t("viewCode.copied"));
  };

  const onCopyReadable = async () => {
    const text = getSnippet(snippets, active, "readable");
    await navigator.clipboard.writeText(text);
    toast.success(t("viewCode.copiedReadable"));
  };

  const onCopyFull = async () => {
    const text = getSnippet(snippets, active, "full");
    await navigator.clipboard.writeText(text);
    toast.success(t("viewCode.copiedFull"));
  };

  const currentText = getSnippet(snippets, active, view);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("viewCode.title")}</DialogTitle>
        </DialogHeader>

        {showBase64Affordances && (
          <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{t("viewCode.base64Banner", { kb })}</span>
          </div>
        )}

        {showBase64Affordances && (
          <div className="flex items-center gap-3">
            <label className="flex cursor-pointer items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="base64-view"
                value="readable"
                checked={view === "readable"}
                onChange={() => setView("readable")}
                className="accent-primary"
              />
              {t("viewCode.viewReadable")}
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="base64-view"
                value="full"
                checked={view === "full"}
                onChange={() => setView("full")}
                className="accent-primary"
              />
              {t("viewCode.viewFull")}
            </label>
          </div>
        )}

        <Tabs value={active} onValueChange={(v) => setActive(v as Lang)}>
          <div className="flex items-center justify-between gap-2">
            <TabsList>
              <TabsTrigger value="curl">curl</TabsTrigger>
              <TabsTrigger value="python">Python</TabsTrigger>
              <TabsTrigger value="node">Node.js</TabsTrigger>
            </TabsList>
            {showBase64Affordances ? (
              <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" onClick={onCopyReadable}>
                  <Copy className="mr-1 h-3 w-3" />
                  {t("viewCode.copyReadable")}
                </Button>
                <Button size="sm" variant="outline" onClick={onCopyFull}>
                  <Copy className="mr-1 h-3 w-3" />
                  {t("viewCode.copyFull")}
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={onCopy}>
                <Copy className="mr-1 h-3 w-3" />
                {t("viewCode.copy")}
              </Button>
            )}
          </div>
          <TabsContent value="curl">
            <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 text-xs">
              {currentText}
            </pre>
          </TabsContent>
          <TabsContent value="python">
            <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 text-xs">
              {currentText}
            </pre>
          </TabsContent>
          <TabsContent value="node">
            <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 text-xs">
              {currentText}
            </pre>
          </TabsContent>
        </Tabs>
        <p className="text-[10px] italic text-muted-foreground">{t("viewCode.keyPlaceholder")}</p>
      </DialogContent>
    </Dialog>
  );
}
