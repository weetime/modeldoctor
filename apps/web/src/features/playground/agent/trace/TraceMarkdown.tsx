import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Compact GitHub-flavoured markdown renderer for agent assistant/plan text.
 * There's no `@tailwindcss/typography` (`prose`) in this app, so element
 * styling is supplied explicitly via `components` — kept tight to fit inside a
 * trace card (small headings, list indents, inline code chips).
 */
const COMPONENTS: ComponentPropsWithoutRef<typeof ReactMarkdown>["components"] = {
  p: ({ node, ...props }) => <p className="mb-2 last:mb-0 leading-relaxed" {...props} />,
  ul: ({ node, ...props }) => <ul className="mb-2 list-disc pl-5 last:mb-0" {...props} />,
  ol: ({ node, ...props }) => <ol className="mb-2 list-decimal pl-5 last:mb-0" {...props} />,
  li: ({ node, ...props }) => <li className="mb-0.5" {...props} />,
  h1: ({ node, ...props }) => <h1 className="mb-2 mt-1 text-base font-semibold" {...props} />,
  h2: ({ node, ...props }) => <h2 className="mb-2 mt-1 text-sm font-semibold" {...props} />,
  h3: ({ node, ...props }) => <h3 className="mb-1 mt-1 text-sm font-semibold" {...props} />,
  a: ({ node, ...props }) => (
    <a className="text-primary underline" target="_blank" rel="noreferrer" {...props} />
  ),
  code: ({ node, ...props }) => (
    <code
      className="rounded bg-muted px-1 py-0.5 font-mono text-[0.8em] text-foreground"
      {...props}
    />
  ),
  pre: ({ node, ...props }) => (
    <pre
      className="mb-2 overflow-x-auto rounded bg-muted p-2 font-mono text-xs last:mb-0"
      {...props}
    />
  ),
  table: ({ node, ...props }) => (
    <div className="mb-2 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-xs" {...props} />
    </div>
  ),
  th: ({ node, ...props }) => (
    <th className="border border-border px-2 py-1 text-left font-medium" {...props} />
  ),
  td: ({ node, ...props }) => <td className="border border-border px-2 py-1" {...props} />,
};

export function TraceMarkdown({ children }: { children: string }) {
  return (
    <div className="text-sm text-foreground">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
