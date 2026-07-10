import type { ComponentPropsWithoutRef } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders the model's plan (the `plan`-kind step emitted on the first turn when
 * "Plan first" is on) as a checklist. List items get a ☐ glyph so it reads like
 * a todo. No auto-checking — a free-text plan has no reliable mapping to the
 * actual tool calls, so items stay unchecked; the execution trace below is the
 * honest record of what happened.
 */
const COMPONENTS: ComponentPropsWithoutRef<typeof ReactMarkdown>["components"] = {
  p: ({ node, ...props }) => <p className="mb-1 last:mb-0 leading-relaxed" {...props} />,
  ul: ({ node, ...props }) => <ul className="space-y-1" {...props} />,
  ol: ({ node, ...props }) => <ol className="space-y-1" {...props} />,
  li: ({ node, children, ...props }) => (
    <li className="flex items-start gap-2" {...props}>
      <span aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground">
        ☐
      </span>
      <span>{children}</span>
    </li>
  ),
};

export function PlanStrip({ content }: { content: string }) {
  const { t } = useTranslation("playground");
  return (
    <div
      data-testid="agent-plan-strip"
      className="sticky top-0 z-10 mb-1 rounded-md border border-primary/30 bg-primary/5 px-3 py-2"
    >
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-foreground">
        <span aria-hidden="true">📋</span>
        {t("agent.trace.planTitle")}
      </div>
      <div className="text-sm text-foreground">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
