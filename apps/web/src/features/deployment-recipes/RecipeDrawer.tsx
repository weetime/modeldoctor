import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Check, Copy, ExternalLink, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { EngineMeta, EngineRecipe, ModelEntry } from "./types";

interface RecipeDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: ModelEntry | null;
  engine: EngineMeta | null;
  recipe: EngineRecipe | null;
}

function StatusBadge({ status }: { status: EngineRecipe["status"] }) {
  const { t } = useTranslation("deployment-recipes");
  if (status === "native") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400">
        <Check className="h-3 w-3" /> {t("status.native")}
      </span>
    );
  }
  if (status === "partial") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400">
        {t("status.partial")}
      </span>
    );
  }
  if (status === "community") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-400">
        ★ {t("status.community")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      {t("status.none")}
    </span>
  );
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  const { t } = useTranslation("deployment-recipes");
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success(t("drawer.copyToast"));
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error(t("drawer.copyFailed"));
    }
  };

  return (
    <div className="group relative">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className="h-7 gap-1.5 px-2 text-xs"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? t("drawer.copied") : t("drawer.copy")}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-md border border-border bg-muted/60 p-3 font-mono text-xs leading-relaxed text-foreground">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export function RecipeDrawer({ open, onOpenChange, model, engine, recipe }: RecipeDrawerProps) {
  const { t } = useTranslation("deployment-recipes");

  // Bail out entirely when the URL hash points to a non-existent (or unsupported)
  // model/engine combo — rendering a Root with only a Portal would otherwise
  // leave a ghost overlay that swallows clicks.
  if (!model || !engine || !recipe) return null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex w-full max-w-[640px] flex-col border-l border-border bg-background shadow-2xl",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
            "duration-200",
          )}
        >
          <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-base font-semibold leading-snug">
                {model.name}
                <span className="mx-2 text-muted-foreground/60">×</span>
                <span className="text-primary">{engine.name}</span>
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span>{model.meta}</span>
                <span>·</span>
                <span>{engine.vendor}</span>
                <span>·</span>
                <StatusBadge status={recipe.status} />
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                aria-label={t("drawer.close")}
              >
                <X className="h-4 w-4" />
              </Button>
            </DialogPrimitive.Close>
          </header>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            <section className="space-y-2.5">
              {recipe.image ? (
                <FieldRow
                  label={t("drawer.image")}
                  value={<code className="font-mono text-xs">{recipe.image}</code>}
                />
              ) : null}
              {recipe.minVersion ? (
                <FieldRow
                  label={t("drawer.minVersion")}
                  value={<code className="font-mono text-xs">{recipe.minVersion}</code>}
                />
              ) : null}
              {recipe.resource ? (
                <FieldRow label={t("drawer.resource")} value={recipe.resource} />
              ) : null}
            </section>

            {recipe.command ? (
              <section className="mt-6">
                <CodeBlock code={recipe.command} label={t("drawer.command")} />
              </section>
            ) : null}

            {recipe.params && recipe.params.length > 0 ? (
              <section className="mt-6">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("drawer.params")}
                </h3>
                <div className="overflow-hidden rounded-md border border-border">
                  <table className="w-full text-sm">
                    <tbody>
                      {recipe.params.map((p, idx) => (
                        <tr
                          key={p.key}
                          className={cn(idx > 0 && "border-t border-border", "align-top")}
                        >
                          <td className="w-56 bg-muted/40 px-3 py-2 font-mono text-xs">{p.key}</td>
                          <td className="px-3 py-2 font-mono text-xs text-primary">{p.value}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{p.desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            {recipe.notes ? (
              <section className="mt-6">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("drawer.notes")}
                </h3>
                <p className="rounded-md border-l-2 border-amber-400 bg-amber-50/40 px-3 py-2 text-sm leading-relaxed text-foreground/90 dark:bg-amber-950/20">
                  {recipe.notes}
                </p>
              </section>
            ) : null}

            {recipe.docUrl ? (
              <section className="mt-6">
                <a
                  href={recipe.docUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {t("drawer.docs")}
                </a>
              </section>
            ) : null}

            {!recipe.command && !recipe.image && !recipe.notes ? (
              <section className="mt-6 rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                {recipe.tooltip ?? t("drawer.emptyFallback")}
              </section>
            ) : null}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
