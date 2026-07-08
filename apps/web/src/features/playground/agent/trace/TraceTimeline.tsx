import type { AgentStep } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";
import type { PendingInlineTool } from "../store";
import { PendingToolCard, StepCard } from "./StepCard";

export interface TraceTimelineProps {
  steps: AgentStep[];
  pendingInlineTool: PendingInlineTool | null;
  onSubmitToolResult: (resultContent: string) => void;
  submittingToolResult?: boolean;
}

/** Vertical list of `StepCard`s, plus the pending inline-tool card at the end. */
export function TraceTimeline({
  steps,
  pendingInlineTool,
  onSubmitToolResult,
  submittingToolResult,
}: TraceTimelineProps) {
  const { t } = useTranslation("playground");

  if (steps.length === 0 && !pendingInlineTool) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
        {t("agent.trace.empty")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 overflow-y-auto px-6 py-4">
      {steps.map((step, idx) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: append-only trace list
        <StepCard key={idx} step={step} />
      ))}
      {pendingInlineTool ? (
        <PendingToolCard
          tool={pendingInlineTool}
          onSubmit={onSubmitToolResult}
          submitting={submittingToolResult}
        />
      ) : null}
    </div>
  );
}
