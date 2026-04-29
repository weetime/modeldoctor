import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Copy } from "lucide-react";
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

export function ViewCodeDialog({ open, onOpenChange, snippets }: ViewCodeDialogProps) {
  const { t } = useTranslation("playground");
  const [active, setActive] = useState<Lang>("curl");

  const onCopy = async () => {
    await navigator.clipboard.writeText(snippets[active]);
    toast.success(t("viewCode.copied"));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("viewCode.title")}</DialogTitle>
        </DialogHeader>
        <Tabs value={active} onValueChange={(v) => setActive(v as Lang)}>
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="curl">curl</TabsTrigger>
              <TabsTrigger value="python">Python</TabsTrigger>
              <TabsTrigger value="node">Node.js</TabsTrigger>
            </TabsList>
            <Button size="sm" variant="outline" onClick={onCopy}>
              <Copy className="mr-1 h-3 w-3" />
              {t("viewCode.copy")}
            </Button>
          </div>
          <TabsContent value="curl">
            <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 text-xs">
              {snippets.curl}
            </pre>
          </TabsContent>
          <TabsContent value="python">
            <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 text-xs">
              {snippets.python}
            </pre>
          </TabsContent>
          <TabsContent value="node">
            <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 text-xs">
              {snippets.node}
            </pre>
          </TabsContent>
        </Tabs>
        <p className="text-[10px] italic text-muted-foreground">{t("viewCode.keyPlaceholder")}</p>
      </DialogContent>
    </Dialog>
  );
}
