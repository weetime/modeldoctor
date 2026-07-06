import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "@/lib/api-client";

/**
 * Minimal shape of a raw τ³-bench `results.json` (the runner's per-domain
 * output, stored under the `results_<domain>` file alias — see Task 4's
 * buildCommand). This is intentionally NOT the same as `Tau3Report`
 * (`@modeldoctor/tool-adapters/schemas`), which is the aggregated
 * summary.json the gate/report reads. We only type the fields the
 * conversation-replay UI actually reads; upstream τ³-bench's `Message` /
 * `Simulation` types carry many more fields we pass through untouched.
 */
export type Tau3MessageRole = "user" | "assistant" | "tool" | "system";

export interface Tau3ToolCall {
  id?: string;
  name: string;
  arguments?: Record<string, unknown> | string;
}

export interface Tau3Message {
  role: Tau3MessageRole;
  content?: string | null;
  tool_calls?: Tau3ToolCall[] | null;
  tool_call_id?: string;
  [extra: string]: unknown;
}

export interface Tau3ActionCheckAction {
  name?: string;
  requestor?: string;
  [extra: string]: unknown;
}

export interface Tau3ActionCheck {
  action_match: boolean;
  tool_type?: string;
  action?: Tau3ActionCheckAction | null;
  [extra: string]: unknown;
}

export interface Tau3RewardInfo {
  reward: number;
  action_checks?: Tau3ActionCheck[] | null;
  [extra: string]: unknown;
}

export interface Tau3Simulation {
  id: string;
  task_id: string;
  trial: number;
  termination_reason?: string;
  reward_info?: Tau3RewardInfo | null;
  messages: Tau3Message[];
  [extra: string]: unknown;
}

export interface Tau3Results {
  simulations: Tau3Simulation[];
  [extra: string]: unknown;
}

export const trajectoryKeys = {
  all: ["benchmarks", "trajectory"] as const,
  detail: (benchmarkId: string, domain: string) =>
    [...trajectoryKeys.all, benchmarkId, domain] as const,
};

/**
 * Fetches the domain's raw τ³-bench `results.json` via the benchmark's
 * generic output-file endpoint (`GET /benchmarks/:id/files/results_<domain>`)
 * and indexes simulations by id for the conversation-replay picker.
 *
 * The run's `results.json` is immutable once the benchmark is terminal, so
 * this is cached for the page's lifetime (mirrors `useBenchmarkCharts`).
 */
export function useTrajectory(benchmarkId: string, domain: string) {
  const query = useQuery({
    queryKey: trajectoryKeys.detail(benchmarkId, domain),
    queryFn: () => api.get<Tau3Results>(`/api/benchmarks/${benchmarkId}/files/results_${domain}`),
    enabled: benchmarkId.length > 0 && domain.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 5 * 60 * 1000,
  });

  const simsById = useMemo(() => {
    const map = new Map<string, Tau3Simulation>();
    for (const sim of query.data?.simulations ?? []) map.set(sim.id, sim);
    return map;
  }, [query.data]);

  return { ...query, simsById };
}
