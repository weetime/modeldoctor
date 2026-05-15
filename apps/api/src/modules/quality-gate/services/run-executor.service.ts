import type { JudgeConfig } from "@modeldoctor/contracts";
import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import pLimit from "p-limit";
import { EndpointCaller } from "../endpoint-caller.js";
import { computeGateResult } from "../gate/compute-gate-result.js";
import { aggregateMetrics, computeDelta } from "../gate/sample-aggregation.js";
import { JudgesService } from "../judges/judges.service.js";
import { RunsRepository } from "../repositories/runs.repository.js";

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
  baselineRunIdAtExecution?: string | null;
}

@Injectable()
export class QualityGateRunExecutor implements OnModuleInit, OnModuleDestroy {
  private readonly active = new Map<string, { ac: AbortController; promise: Promise<void> }>();

  constructor(
    private readonly repo: RunsRepository,
    private readonly endpointCaller: EndpointCaller,
    private readonly judges: JudgesService,
  ) {}

  async onModuleInit() {
    await this.repo.sweepRunningOnBoot();
  }

  // Controllers fire-and-forget `void executor.start(...)`, so without an
  // explicit shutdown hook the executor can outlive the Prisma engine — the
  // catch path then throws `Engine is not yet connected` as an unhandled
  // rejection (seen in e2e teardown). Abort all in-flight runs and await
  // them so markCancelled / markFailed completes while Prisma is still up.
  async onModuleDestroy() {
    const inflight = [...this.active.values()];
    for (const { ac } of inflight) ac.abort();
    await Promise.allSettled(inflight.map((v) => v.promise));
  }

  async start(runId: string): Promise<void> {
    const ac = new AbortController();
    const promise = this.runInternal(runId, ac);
    this.active.set(runId, { ac, promise });
    await promise;
  }

  private async runInternal(runId: string, ac: AbortController): Promise<void> {
    try {
      const run = (await this.repo.findFullRun(runId)) as FullRun | null;
      if (!run) throw new Error(`run ${runId} not found`);
      await this.repo.markRunning(runId);

      const sampleLimit = pLimit(SAMPLE_CONCURRENCY);
      const judgeLimit = pLimit(JUDGE_CONCURRENCY);
      let processed = 0;
      let judgeCalls = 0;

      // Snapshot-locked baseline: load once at start (mid-flight repins won't affect this run)
      const baselineSamplesById = run.baselineRunIdAtExecution
        ? await this.repo.loadCompletedSamplesById(run.baselineRunIdAtExecution)
        : new Map<string, { resultA: unknown }>();
      const baselineMode = run.baselineRunIdAtExecution != null;

      const samples = run.evaluationSnapshot.samples;
      await Promise.all(
        samples.map((s) =>
          sampleLimit(async () => {
            if (ac.signal.aborted) return;

            // 1. Today's call (always endpointAId)
            const callA = await this.endpointCaller.call(
              run.endpointAId,
              run.userId,
              s.prompt,
              ac.signal,
            );
            if (ac.signal.aborted) return;
            const judgedA = await judgeLimit(() =>
              this.judges.apply(s.judgeConfig, {
                question: s.prompt,
                expected: s.expected,
                answer: callA.rawAnswer,
              }),
            );
            if (s.judgeConfig.kind === "llm-judge") judgeCalls++;

            // 2. B side: either baseline lookup or endpointBId call
            let callB: typeof callA | null = null;
            let judgedB: typeof judgedA | null = null;
            if (baselineMode) {
              const baseRow = baselineSamplesById.get(s.id);
              if (baseRow && (baseRow.resultA as { call?: unknown; judge?: unknown })?.call) {
                const baselineResultA = baseRow.resultA as {
                  call: typeof callA;
                  judge: typeof judgedA;
                };
                callB = baselineResultA.call;
                judgedB = baselineResultA.judge;
              }
              // else: sample missing in baseline → keep B null → delta=NA
            } else if (run.endpointBId) {
              const result = await this.endpointCaller.call(
                run.endpointBId,
                run.userId,
                s.prompt,
                ac.signal,
              );
              callB = result;
              if (!ac.signal.aborted) {
                judgedB = await judgeLimit(() =>
                  this.judges.apply(s.judgeConfig, {
                    question: s.prompt,
                    expected: s.expected,
                    answer: result.rawAnswer,
                  }),
                );
                if (s.judgeConfig.kind === "llm-judge") judgeCalls++;
              }
            }

            // 3. Delta — semantic always "A=baseline, B=candidate"
            //    Dual mode: A=baselineEndpoint, B=candidateEndpoint → computeDelta(judgedA, judgedB) ✓
            //    Baseline mode: storage has resultA=today, resultB=baseline.resultA.
            //                   baseline=B (storage), candidate=A (today) → computeDelta(judgedB, judgedA)
            //    When baseline sample is missing (judgedB=null), delta=NA without calling computeDelta
            //    (computeDelta's null-check is on its second arg, not first).
            const delta = baselineMode
              ? judgedB != null
                ? computeDelta(judgedB, judgedA)
                : "NA"
              : computeDelta(judgedA, judgedB);

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
        await this.repo.markCancelled(runId).catch(() => undefined);
        return;
      }
      const rows = await this.repo.sampleRowsForAggregate(runId);
      const metrics = aggregateMetrics(rows as never, judgeCalls);
      const gate = computeGateResult(metrics, run.gateConfig);
      await this.repo.markCompleted(runId, metrics, gate);
    } catch (e) {
      // .catch(() => undefined): if shutdown raced past onModuleDestroy and
      // Prisma is already disconnected, swallow rather than producing an
      // unhandled rejection that crashes the process / fails the test run.
      await this.repo
        .markFailed(runId, e instanceof Error ? e.message : String(e))
        .catch(() => undefined);
    } finally {
      this.active.delete(runId);
    }
  }

  cancel(runId: string) {
    this.active.get(runId)?.ac.abort();
  }
}
