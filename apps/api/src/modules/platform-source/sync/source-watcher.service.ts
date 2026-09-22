import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { GpustackClientFactory } from "../gpustack/gpustack-client.js";
import { PlatformSourcesService } from "../sources/platform-sources.service.js";
import { SourceSyncService } from "./source-sync.service.js";

export const DEBOUNCE_MS = 2000;
export const BACKOFF_MIN_MS = 1000;
export const BACKOFF_MAX_MS = 60_000;

interface WatchState {
  abort: AbortController;
  debounce?: NodeJS.Timeout;
  retry?: NodeJS.Timeout;
  backoffMs: number;
}

@Injectable()
export class SourceWatcherService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(SourceWatcherService.name);
  private readonly states = new Map<string, WatchState>();

  constructor(
    private readonly sources: PlatformSourcesService,
    private readonly clients: GpustackClientFactory,
    private readonly sync: SourceSyncService,
  ) {
    this.sources.onChange((id, kind) => {
      this.stop(id);
      if (kind === "upsert") this.start(id);
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    for (const id of await this.sources.listEnabledIds()) this.start(id);
  }

  async onModuleDestroy(): Promise<void> {
    for (const id of [...this.states.keys()]) this.stop(id);
  }

  isWatching(sourceId: string): boolean {
    return this.states.has(sourceId);
  }

  start(sourceId: string): void {
    if (this.states.has(sourceId)) return;
    const state: WatchState = { abort: new AbortController(), backoffMs: BACKOFF_MIN_MS };
    this.states.set(sourceId, state);
    void this.loop(sourceId, state);
  }

  stop(sourceId: string): void {
    const s = this.states.get(sourceId);
    if (!s) return;
    s.abort.abort();
    clearTimeout(s.debounce);
    clearTimeout(s.retry);
    this.states.delete(sourceId);
  }

  private reconcileSafe(sourceId: string): void {
    this.sync
      .reconcile(sourceId)
      .catch((e) => this.log.warn(`reconcile ${sourceId} failed: ${(e as Error).message}`));
  }

  private async loop(sourceId: string, state: WatchState): Promise<void> {
    if (state.abort.signal.aborted) return;
    try {
      const src = await this.sources.getDecrypted(sourceId);
      if (!src.enabled) {
        this.stop(sourceId);
        return;
      }
      const client = await this.clients.create(src.baseUrl, src.apiKey);
      this.reconcileSafe(sourceId); // 连上（或重连）先全量对账，补上断线期间的变更
      await client.watchModels({
        signal: state.abort.signal,
        onEvent: () => {
          state.backoffMs = BACKOFF_MIN_MS;
          clearTimeout(state.debounce);
          state.debounce = setTimeout(() => this.reconcileSafe(sourceId), DEBOUNCE_MS);
        },
      });
    } catch (e) {
      this.log.warn(`watch ${sourceId} error: ${(e as Error).message}`);
    }
    if (state.abort.signal.aborted || this.states.get(sourceId) !== state) return;
    const delay = state.backoffMs;
    state.backoffMs = Math.min(state.backoffMs * 2, BACKOFF_MAX_MS);
    state.retry = setTimeout(() => void this.loop(sourceId, state), delay);
  }
}
