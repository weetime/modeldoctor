import type { EvaluationSample } from "@modeldoctor/contracts";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { JudgeConfigEditor } from "./JudgeConfigEditor";

export function EvaluationSampleEditor({
  value,
  onChange,
  onRemove,
  index,
}: {
  value: EvaluationSample;
  onChange: (v: EvaluationSample) => void;
  onRemove: () => void;
  index: number;
}) {
  return (
    <div className="rounded border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">#{index + 1}</span>
        <Button variant="ghost" size="sm" className="text-destructive" onClick={onRemove}>
          删除
        </Button>
      </div>
      <div className="space-y-1">
        <label className="text-sm" htmlFor={`prompt-${index}`}>
          题面 / prompt
        </label>
        <Textarea
          id={`prompt-${index}`}
          rows={2}
          value={value.prompt}
          onChange={(e) => onChange({ ...value, prompt: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <label className="text-sm" htmlFor={`expected-${index}`}>
          期望答案 / expected
        </label>
        <Textarea
          id={`expected-${index}`}
          rows={2}
          value={value.expected}
          onChange={(e) => onChange({ ...value, expected: e.target.value })}
        />
      </div>
      <JudgeConfigEditor
        value={value.judgeConfig}
        onChange={(jc) => onChange({ ...value, judgeConfig: jc })}
      />
    </div>
  );
}
