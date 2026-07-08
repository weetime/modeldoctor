import type { AgentStep } from "@modeldoctor/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { PendingInlineTool } from "../store";

const KIND_ICON: Record<AgentStep["kind"], string> = {
  plan: "🧠",
  tool_call: "🔧",
  tool_result: "📥",
  assistant: "💬",
  error: "⚠️",
};

const KIND_STYLE: Record<AgentStep["kind"], string> = {
  plan: "border-border bg-card",
  tool_call: "border-border bg-card",
  tool_result: "border-border bg-card",
  assistant: "border-border bg-card",
  error: "border-destructive/40 bg-destructive/10",
};

export interface StepCardProps {
  step: AgentStep;
}

/** Renders one AgentStep by kind, with an emoji icon + elapsed time. */
export function StepCard({ step }: StepCardProps) {
  const { t } = useTranslation("playground");
  return (
    <div
      data-testid={`step-${step.kind}`}
      className={`rounded-md border px-3 py-2 text-sm ${KIND_STYLE[step.kind]}`}
    >
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5 font-medium text-foreground">
          <span aria-hidden="true">{KIND_ICON[step.kind]}</span>
          {t(`agent.steps.${step.kind}`)}
          {step.name ? (
            <span className="font-mono font-normal text-muted-foreground">· {step.name}</span>
          ) : null}
        </span>
        <span>{step.tMs}ms</span>
      </div>
      {step.kind === "tool_call" ? (
        <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-xs text-muted-foreground">
          {JSON.stringify(step.args ?? {}, null, 2)}
        </pre>
      ) : step.content ? (
        <p className="mt-1 whitespace-pre-wrap break-words">{step.content}</p>
      ) : null}
    </div>
  );
}

export interface PendingToolCardProps {
  tool: PendingInlineTool;
  onSubmit: (resultContent: string) => void;
  submitting?: boolean;
}

/**
 * Rendered at the end of the trace when the loop emitted
 * `tool_result_needed` for a hand-authored inline tool (no server-side
 * executor). The user pastes/types the tool's result and submits it, which
 * triggers a continuation `POST /api/playground/agent` request.
 */
export function PendingToolCard({ tool, onSubmit, submitting }: PendingToolCardProps) {
  const { t } = useTranslation("playground");
  const [value, setValue] = useState("");

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        <span aria-hidden="true">🧩</span>
        {t("agent.pendingTool.title", { name: tool.name })}
      </div>
      <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-xs text-muted-foreground">
        {JSON.stringify(tool.args ?? {}, null, 2)}
      </pre>
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t("agent.pendingTool.placeholder")}
        className="mt-2 h-20 font-mono text-xs"
      />
      <Button
        type="button"
        size="sm"
        className="mt-2"
        disabled={submitting || value.trim().length === 0}
        onClick={() => onSubmit(value)}
      >
        {t("agent.pendingTool.submit")}
      </Button>
    </div>
  );
}
