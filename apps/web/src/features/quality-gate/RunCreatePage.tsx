import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { GateConfig } from "@modeldoctor/contracts";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConnections } from "@/features/connections/queries";
import { GateConfigForm } from "./components/GateConfigForm";
import { useCreateRun, useEvaluations } from "./queries";

export function RunCreatePage() {
  const nav = useNavigate();
  const evals = useEvaluations();
  const conns = useConnections();
  const create = useCreateRun();
  const [evaluationId, setEvalId] = useState<string | undefined>();
  const [endpointAId, setA] = useState<string | undefined>();
  const [endpointBId, setB] = useState<string | undefined>();
  const [gate, setGate] = useState<GateConfig>({ passRateMin: 0.9 });

  return (
    <div className="p-6 max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">新建评测运行</h1>

      <div className="space-y-1">
        <Label>评测集</Label>
        <Select value={evaluationId} onValueChange={setEvalId}>
          <SelectTrigger>
            <SelectValue placeholder="选择评测集" />
          </SelectTrigger>
          <SelectContent>
            {evals.data?.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.name} ({e.totalSamples})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Endpoint A（基线）</Label>
          <Select value={endpointAId} onValueChange={setA}>
            <SelectTrigger>
              <SelectValue placeholder="选择" />
            </SelectTrigger>
            <SelectContent>
              {conns.data?.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Endpoint B（新版本，可选）</Label>
          <Select
            value={endpointBId ?? "__none__"}
            onValueChange={(v) => setB(v === "__none__" ? undefined : v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">不对比</SelectItem>
              {conns.data
                ?.filter((c) => c.id !== endpointAId)
                .map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <GateConfigForm value={gate} onChange={setGate} dual={!!endpointBId} />

      <Button
        disabled={!evaluationId || !endpointAId}
        onClick={async () => {
          const run = await create.mutateAsync({
            evaluationId: evaluationId!,
            endpointAId: endpointAId!,
            endpointBId,
            gateConfig: gate,
          });
          nav(`/quality-gate/runs/${run.id}`);
        }}
      >
        触发评测
      </Button>
    </div>
  );
}
