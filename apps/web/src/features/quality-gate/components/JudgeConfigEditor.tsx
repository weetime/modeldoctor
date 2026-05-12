import type { JudgeConfig } from "@modeldoctor/contracts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

interface JudgeConfigEditorProps {
  value: JudgeConfig;
  onChange: (v: JudgeConfig) => void;
}

export function JudgeConfigEditor({ value, onChange }: JudgeConfigEditorProps) {
  const setKind = (k: JudgeConfig["kind"]) => {
    if (k === "exact-match") onChange({ kind: "exact-match" });
    else if (k === "contains") onChange({ kind: "contains", substrings: [], mode: "all" });
    else if (k === "regex") onChange({ kind: "regex", pattern: "" });
    else onChange({ kind: "llm-judge", rubric: "", scale: "0-5" });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="qg-judge-kind">判分器 / Kind</Label>
        <Select value={value.kind} onValueChange={(k) => setKind(k as JudgeConfig["kind"])}>
          <SelectTrigger id="qg-judge-kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="exact-match">exact-match — 精确匹配</SelectItem>
            <SelectItem value="contains">contains — 关键词包含</SelectItem>
            <SelectItem value="regex">regex — 正则</SelectItem>
            <SelectItem value="llm-judge">llm-judge — LLM 评分</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {value.kind === "exact-match" && (
        <div className="flex items-center gap-3">
          <Label htmlFor="qg-cs">区分大小写 / case sensitive</Label>
          <Switch
            id="qg-cs"
            checked={value.caseSensitive === true}
            onCheckedChange={(b) => onChange({ ...value, caseSensitive: b })}
          />
        </div>
      )}

      {value.kind === "contains" && (
        <>
          <div className="space-y-1">
            <Label htmlFor="qg-subs">子串列表（逗号分隔）/ substrings</Label>
            <Input
              id="qg-subs"
              value={value.substrings.join(", ")}
              onChange={(e) =>
                onChange({
                  ...value,
                  substrings: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="qg-mode">模式 / mode</Label>
            <Select
              value={value.mode}
              onValueChange={(m) => onChange({ ...value, mode: m as "all" | "any" })}
            >
              <SelectTrigger id="qg-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部命中 / all</SelectItem>
                <SelectItem value="any">任意命中 / any</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {value.kind === "regex" && (
        <>
          <div className="space-y-1">
            <Label htmlFor="qg-pat">模式 / pattern</Label>
            <Input
              id="qg-pat"
              value={value.pattern}
              onChange={(e) => onChange({ ...value, pattern: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="qg-flags">flags（可选）</Label>
            <Input
              id="qg-flags"
              value={value.flags ?? ""}
              onChange={(e) => onChange({ ...value, flags: e.target.value || undefined })}
            />
          </div>
        </>
      )}

      {value.kind === "llm-judge" && (
        <>
          <div className="space-y-1">
            <Label htmlFor="qg-rubric">评分准则 / rubric</Label>
            <Textarea
              id="qg-rubric"
              rows={4}
              value={value.rubric}
              onChange={(e) => onChange({ ...value, rubric: e.target.value })}
              placeholder="判断助手是否..."
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="qg-scale">分制 / scale</Label>
            <Select
              value={value.scale}
              onValueChange={(s) =>
                onChange({ ...value, scale: s as "0-1" | "0-5" | "pass-fail" })
              }
            >
              <SelectTrigger id="qg-scale">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0-1">0–1</SelectItem>
                <SelectItem value="0-5">0–5</SelectItem>
                <SelectItem value="pass-fail">pass/fail</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="qg-thr">passThreshold（默认按 scale 推断）</Label>
            <Input
              id="qg-thr"
              type="number"
              step="0.1"
              value={value.passThreshold ?? ""}
              onChange={(e) =>
                onChange({
                  ...value,
                  passThreshold: e.target.value ? Number(e.target.value) : undefined,
                })
              }
            />
          </div>
        </>
      )}
    </div>
  );
}
