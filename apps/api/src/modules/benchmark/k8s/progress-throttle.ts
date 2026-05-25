import type { BenchmarkRepository } from "../benchmark.repository.js";

/** 1Hz trailing throttle for benchmark.progress DB writes.
 *  Coalesces high-frequency progress ticks (line-rate) into ≤ 1 write/sec/run.
 *  Last value wins; flushNow() drains any pending tick (called from pool
 *  drainAndStop / stop / onModuleDestroy so the terminal value is durable). */
export class ProgressThrottle {
  private pendingPct: number | null = null;
  private lastWriteAt = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly runId: string,
    private readonly repo: Pick<BenchmarkRepository, "update">,
    private readonly windowMs: number,
    private readonly clock: () => number = Date.now,
  ) {}

  tick(pct: number): void {
    this.pendingPct = pct;
    const elapsed = this.clock() - this.lastWriteAt;
    if (elapsed >= this.windowMs) {
      void this.doFlush();
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => void this.doFlush(), this.windowMs - elapsed);
    }
  }

  private async doFlush(): Promise<void> {
    await this.flushNow();
  }

  async flushNow(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pendingPct === null) return;
    const pct = this.pendingPct;
    this.pendingPct = null;
    this.lastWriteAt = this.clock();
    try {
      await this.repo.update(this.runId, { progress: pct });
    } catch {
      // progress is best-effort; final value lands via the ReportLoader path
    }
  }
}
