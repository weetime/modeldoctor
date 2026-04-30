import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export interface PromptComposerProps {
  value: string;
  onChange: (s: string) => void;
  onSubmit: () => void;
  sendLabel: string;
  sendDisabled?: boolean;
  placeholder?: string;
  rows?: number;
  inputId?: string;
  /** Optional icon-button row stacked above the Send button. */
  toolbar?: ReactNode;
  /**
   * Enter behaviour. "submit" (default) — Enter sends, Shift+Enter newlines.
   * "newline" — Enter always inserts a newline.
   */
  enterBehaviour?: "submit" | "newline";
  className?: string;
}

/**
 * Canonical Playground input-row layout: prompt textarea on the left, an
 * optional icon toolbar stacked above the Send button on the right. Mirrors
 * the structure the chat MessageComposer uses, so image / inpaint / TTS
 * pages stay visually consistent.
 */
export function PromptComposer({
  value,
  onChange,
  onSubmit,
  sendLabel,
  sendDisabled,
  placeholder,
  rows = 2,
  inputId,
  toolbar,
  enterBehaviour = "submit",
  className,
}: PromptComposerProps) {
  return (
    <div className={cn("flex gap-2", className)}>
      <Textarea
        id={inputId}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (enterBehaviour === "submit" && e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (!sendDisabled) onSubmit();
          }
        }}
        placeholder={placeholder}
        className="text-sm"
      />
      <div className="flex flex-col gap-1">
        {toolbar ? <div className="flex items-center gap-1">{toolbar}</div> : null}
        <Button onClick={onSubmit} disabled={sendDisabled}>
          {sendLabel}
        </Button>
      </div>
    </div>
  );
}
