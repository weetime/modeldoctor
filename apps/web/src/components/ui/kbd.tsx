import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

export type KbdProps = HTMLAttributes<HTMLElement>;

/**
 * Inline keyboard-shortcut chip (Linear-style: tight padding, monospace).
 * Pass space-separated keys via children, e.g. `<Kbd>⌘ K</Kbd>` or `<Kbd>?</Kbd>`.
 */
export function Kbd({ className, children, ...props }: KbdProps) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </kbd>
  );
}
