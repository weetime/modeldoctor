import type { JudgeConfig } from "@modeldoctor/contracts";
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import pLimit from "p-limit";
import type { EndpointCaller } from "../endpoint-caller.js";
import { computeGateResult } from "../gate/compute-gate-result.js";
import { aggregateMetrics, computeDelta } from "../gate/sample-aggregation.js";
import type { JudgeRegistry } from "../judges/registry.js";
import type { RunsRepository } from "../repositories/runs.repository.js";

const SAMPLE_CONCURRENCY = 4;
const JUDGE_CONCURRENCY = 2;
const PROGRESS_INTERVAL = 5;

interface FullRun {
  id: string;
  userId: string;
  endpointAId: string;
  endpointBId: string | null;
  evaluationSnapshot: {
    samples: Array<{
      id: string;
      idx: number;
      prompt: string;
      expected: string;
      judgeConfig: JudgeConfig;
    }>;
  };
  gateConfig: import("@modeldoctor/contracts").GateConfig;
}

@Injectable()
export class QualityGateRunExecutor implements OnModuleInit {
  private readonly active = new Map<string, AbortController>();

  constructor(
    private readonly repo: RunsRepository,
    private readonly endpointCaller: EndpointCaller,
    @Inject("JUDGE_REGISTRY") private readonly judges: JudgeRegistry,
  ) {}

  async onModuleInit() {
    await this.repo.sweepRunningOnBoot();
  }

  async start(runId: string): Promise<void> {
    const ac = new AbortController();
    this.active.set(runId, ac);
    try {
      const run = (await this.repo.findFullRun(runId)) as FullRun | null;
      if (!run) throw new Error(`run ${runId} not found`);
      await this.repo.markRunning(runId);

      const sampleLimit = pLimit(SAMPLE_CONCURRENCY);
      const judgeLimit = pLimit(JUDGE_CONCURRENCY);
      let processed = 0;
      let judgeCalls = 0;

      const samples = run.evaluationSnapshot.samples;
      await Promise.all(
        samples.map((s) =>
          sampleLimit(async () => {
            if (ac.signal.aborted) return;
            const [callA, callB] = await Promise.all([
              this.endpointCaller.call(run.endpointAId, run.userId, s.prompt, ac.signal),
              run.endpointBId
                ? this.endpointCaller.call(run.endpointBId, run.userId, s.prompt, ac.signal)
                : Promise.resolve(null),
            ]);
            if (ac.signal.aborted) return;
            const judgedA = await judgeLimit(() =>
              this.judges.apply(s.judgeConfig, {
                question: s.prompt,
                expected: s.expected,
                answer: callA.rawAnswer,
              }),
            );
            if (s.judgeConfig.kind === "llm-judge") judgeCalls++;
            const judgedB =
              callB == null
                ? null
                : await judgeLimit(() =>
                    this.judges.apply(s.judgeConfig, {
                      question: s.prompt,
                      expected: s.expected,
                      answer: callB.rawAnswer,
                    }),
                  );
            if (callB != null && s.judgeConfig.kind === "llm-judge") judgeCalls++;
            const delta = computeDelta(judgedA, judgedB);
            await this.repo.saveSample({
              runId,
              sampleId: s.id,
              sampleIdx: s.idx,
              resultA: { call: callA, judge: judgedA },
              resultB: callB != null && judgedB != null ? { call: callB, judge: judgedB } : null,
              delta,
            });
            processed++;
            if (processed % PROGRESS_INTERVAL === 0)
              await this.repo.updateProgress(runId, processed);
          }),
        ),
      );

      if (ac.signal.aborted) {
        await this.repo.markCancelled(runId);
        return;
      }
      const rows = await this.repo.sampleRowsForAggregate(runId);
      const metrics = aggregateMetrics(rows as never, judgeCalls);
      const gate = computeGateResult(metrics, run.gateConfig);
      await this.repo.markCompleted(runId, metrics, gate);
    } catch (e) {
      await this.repo.markFailed(runId, e instanceof Error ? e.message : String(e));
    } finally {
      this.active.delete(runId);
    }
  }

  cancel(runId: string) {
    this.active.get(runId)?.abort();
  }
}
