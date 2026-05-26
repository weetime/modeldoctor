import type { ProgressEvent } from "@modeldoctor/tool-adapters";
import { Injectable } from "@nestjs/common";
import { EMPTY, type Observable, Subject } from "rxjs";

@Injectable()
export class SseHub {
  private readonly streams = new Map<string, Subject<ProgressEvent>>();
  /** Tracks runIds whose Subject has been completed via close(). Prevents
   *  subscribe() from creating a zombie Subject after the run finishes. */
  private readonly closed = new Set<string>();

  publish(runId: string, evt: ProgressEvent): void {
    this.streams.get(runId)?.next(evt);
  }

  /** Returns EMPTY if the run has already been closed (avoids zombie Subjects). */
  subscribe(runId: string): Observable<ProgressEvent> {
    if (this.closed.has(runId)) return EMPTY;
    let s = this.streams.get(runId);
    if (!s) {
      s = new Subject<ProgressEvent>();
      this.streams.set(runId, s);
    }
    return s.asObservable();
  }

  has(runId: string): boolean {
    return this.streams.has(runId) && !this.closed.has(runId);
  }

  /** Drop a runId's stream (called from BenchmarkService on terminal state). */
  close(runId: string): void {
    const s = this.streams.get(runId);
    if (!s) return;
    s.complete();
    this.streams.delete(runId);
    this.closed.add(runId);
  }
}
