import type { GateConfig } from "@modeldoctor/contracts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function GateConfigForm({
  value,
  onChange,
  dual,
}: {
  value: GateConfig;
  onChange: (v: GateConfig) => void;
  dual: boolean;
}) {
  const enabled = (k: keyof GateConfig) => value[k] != null;
  const toggle = (k: keyof GateConfig, defaultVal: number) => {
    if (enabled(k)) onChange({ ...value, [k]: undefined });
    else onChange({ ...value, [k]: defaultVal });
  };
  return (
    <div className="space-y-3 max-w-md">
      <div className="flex items-center gap-3">
        <Switch
          checked={enabled("passRateMin")}
          onCheckedChange={() => toggle("passRateMin", 0.9)}
        />
        <Label>通过率下限 / passRateMin</Label>
        <Input
          type="number"
          min="0"
          max="1"
          step="0.05"
          className="w-24"
          disabled={!enabled("passRateMin")}
          value={value.passRateMin ?? ""}
          onChange={(e) => onChange({ ...value, passRateMin: Number(e.target.value) })}
        />
      </div>
      {dual && (
        <div className="flex items-center gap-3">
          <Switch
            checked={enabled("regressionMax")}
            onCheckedChange={() => toggle("regressionMax", 3)}
          />
          <Label>回归数上限 / regressionMax</Label>
          <Input
            type="number"
            min="0"
            step="1"
            className="w-24"
            disabled={!enabled("regressionMax")}
            value={value.regressionMax ?? ""}
            onChange={(e) => onChange({ ...value, regressionMax: Number(e.target.value) })}
          />
        </div>
      )}
      <div className="flex items-center gap-3">
        <Switch
          checked={enabled("judgeScoreMin")}
          onCheckedChange={() => toggle("judgeScoreMin", 4)}
        />
        <Label>Judge 均分下限 / judgeScoreMin</Label>
        <Input
          type="number"
          min="0"
          max="5"
          step="0.5"
          className="w-24"
          disabled={!enabled("judgeScoreMin")}
          value={value.judgeScoreMin ?? ""}
          onChange={(e) => onChange({ ...value, judgeScoreMin: Number(e.target.value) })}
        />
      </div>
    </div>
  );
}
