import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Check, Copy, ExternalLink, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { EngineMeta, EngineRecipe, ModelEntry } from "./types";

interface RecipeDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: ModelEntry | null;
  engine: EngineMeta | null;
  recipe: EngineRecipe | null;
}

function StatusBadge({ status }: { status: EngineRecipe["status"] }) {
  if (status === "native") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400">
        <Check className="h-3 w-3" /> 原生支持
      </span>
    );
  }
  if (status === "partial") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400">
        部分 / 实验
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      不支持
    </span>
  );
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("已复制到剪贴板");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("复制失败");
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
          {copied ? "已复制" : "复制"}
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
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </Button>
            </DialogPrimitive.Close>
          </header>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            <section className="space-y-2.5">
              {recipe.image ? (
                <FieldRow
                  label="推荐镜像"
                  value={<code className="font-mono text-xs">{recipe.image}</code>}
                />
              ) : null}
              {recipe.minVersion ? (
                <FieldRow
                  label="最低版本"
                  value={<code className="font-mono text-xs">{recipe.minVersion}</code>}
                />
              ) : null}
              {recipe.resource ? <FieldRow label="资源建议" value={recipe.resource} /> : null}
            </section>

            {recipe.command ? (
              <section className="mt-6">
                <CodeBlock code={recipe.command} label="启动命令" />
              </section>
            ) : null}

            {recipe.params && recipe.params.length > 0 ? (
              <section className="mt-6">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  关键参数
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
                  注意事项
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
                  官方文档
                </a>
              </section>
            ) : null}

            {!recipe.command && !recipe.image && !recipe.notes ? (
              <section className="mt-6 rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                {recipe.tooltip ?? "该组合暂未填充详细配置,欢迎补充。"}
              </section>
            ) : null}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
