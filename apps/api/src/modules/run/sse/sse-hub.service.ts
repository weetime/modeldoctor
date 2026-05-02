import type { ProgressEvent } from "@modeldoctor/tool-adapters";
import { Injectable } from "@nestjs/common";
import { Observable, Subject } from "rxjs";

@Injectable()
export class SseHub {
  private readonly streams = new Map<string, Subject<ProgressEvent>>();

  publish(runId: string, evt: ProgressEvent): void {
    this.streams.get(runId)?.next(evt);
  }

  subscribe(runId: string): Observable<ProgressEvent> {
    let s = this.streams.get(runId);
    if (!s) {
      s = new Subject<ProgressEvent>();
      this.streams.set(runId, s);
    }
    return s.asObservable();
  }

  /** Drop a runId's stream (called from RunService on terminal state). */
  close(runId: string): void {
    const s = this.streams.get(runId);
    if (!s) return;
    s.complete();
    this.streams.delete(runId);
  }
}
