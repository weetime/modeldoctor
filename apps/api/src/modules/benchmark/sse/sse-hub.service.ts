import type { ProgressEvent } from "@modeldoctor/tool-adapters";
import { Injectable } from "@nestjs/common";
import { EMPTY, type Observable, Subject } from "rxjs";

/** Max number of completed runIds retained in the closed queue.
 *  Each entry is just a string, so 1 000 entries ≈ a few KB. */
const CLOSED_QUEUE_LIMIT = 1_000;

@Injectable()
export class SseHub {
  private readonly streams = new Map<string, Subject<ProgressEvent>>();
  /** Bounded queue of recently-closed runIds. Prevents subscribe() from
   *  creating a zombie Subject after close() is called. Evicts oldest
   *  entries once the queue exceeds CLOSED_QUEUE_LIMIT. */
  private readonly closedQueue: string[] = [];
  private readonly closedSet = new Set<string>();

  publish(runId: string, evt: ProgressEvent): void {
    this.streams.get(runId)?.next(evt);
  }

  /** Returns EMPTY if the run has already been closed (avoids zombie Subjects). */
  subscribe(runId: string): Observable<ProgressEvent> {
    if (this.closedSet.has(runId)) return EMPTY;
    let s = this.streams.get(runId);
    if (!s) {
      s = new Subject<ProgressEvent>();
      this.streams.set(runId, s);
    }
    return s.asObservable();
  }

  has(runId: string): boolean {
    return this.streams.has(runId) && !this.closedSet.has(runId);
  }

  /** Drop a runId's stream (called from BenchmarkService on terminal state). */
  close(runId: string): void {
    const s = this.streams.get(runId);
    if (!s) return;
    s.complete();
    this.streams.delete(runId);
    this.closedQueue.push(runId);
    this.closedSet.add(runId);
    if (this.closedQueue.length > CLOSED_QUEUE_LIMIT) {
      const evicted = this.closedQueue.shift();
      if (evicted) this.closedSet.delete(evicted);
    }
  }
}
