import { Injectable } from "@nestjs/common";
import { assertSafeUrl } from "../../connection/discovery/ssrf-guard.js";
import type { GpustackInstance, GpustackModel, GpustackPage, GpustackRoute } from "./types.js";

const PAGE_SIZE = 100;
const LIST_TIMEOUT_MS = 15_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 60_000;

export class GpustackError extends Error {
  override name = "GpustackError";
  constructor(
    message: string,
    public readonly status: number | null = null,
  ) {
    super(message);
  }
}

export class GpustackClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" };
  }

  private async getPage<T>(path: string, page: number, perPage: number): Promise<GpustackPage<T>> {
    const url = `${this.baseUrl}${path}?page=${page}&perPage=${perPage}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: this.headers(),
        signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
      });
    } catch (e) {
      throw new GpustackError(`GET ${path} failed: ${(e as Error).message}`);
    }
    if (!res.ok) throw new GpustackError(`GET ${path} -> HTTP ${res.status}`, res.status);
    return (await res.json()) as GpustackPage<T>;
  }

  private async listAll<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; ; page++) {
      const p = await this.getPage<T>(path, page, PAGE_SIZE);
      out.push(...p.items);
      if (page >= p.pagination.totalPage || p.items.length === 0) return out;
    }
  }

  listModels(): Promise<GpustackModel[]> {
    return this.listAll<GpustackModel>("/v2/models");
  }

  listRoutes(): Promise<GpustackRoute[]> {
    return this.listAll<GpustackRoute>("/v2/model-routes");
  }

  listInstances(): Promise<GpustackInstance[]> {
    return this.listAll<GpustackInstance>("/v2/model-instances");
  }

  async countModels(): Promise<number> {
    const p = await this.getPage<GpustackModel>("/v2/models", 1, 1);
    return p.pagination.total;
  }

  /**
   * 订阅 models 变更。每个非空事件调用一次 onEvent（事件内容不解析 —— 只作对账信号）。
   * 流正常结束 → resolve；网络错误 / HTTP 错误 / 心跳超时 → reject(GpustackError)；
   * 外部 signal abort → resolve。
   */
  async watchModels(opts: {
    signal: AbortSignal;
    onEvent: () => void;
    heartbeatTimeoutMs?: number;
  }): Promise<void> {
    const timeoutMs = opts.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
    const inner = new AbortController();
    const onOuterAbort = () => inner.abort();
    opts.signal.addEventListener("abort", onOuterAbort, { once: true });
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        inner.abort();
      }, timeoutMs);
    };

    try {
      arm();
      const res = await this.fetchImpl(`${this.baseUrl}/v2/models?watch=true`, {
        headers: { ...this.headers(), Accept: "text/event-stream" },
        signal: inner.signal,
      });
      if (!res.ok || !res.body) throw new GpustackError(`watch -> HTTP ${res.status}`, res.status);
      reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await this.readOrAbort(reader, inner.signal);
        if (done) return;
        arm();
        buf += decoder.decode(value, { stream: true });
        let idx = buf.indexOf("\n\n");
        while (idx !== -1) {
          const evt = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 2);
          if (evt) opts.onEvent();
          idx = buf.indexOf("\n\n");
        }
      }
    } catch (e) {
      if (opts.signal.aborted) return;
      if (timedOut) throw new GpustackError(`watch heartbeat timeout after ${timeoutMs}ms`);
      if (e instanceof GpustackError) throw e;
      throw new GpustackError(`watch failed: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
      opts.signal.removeEventListener("abort", onOuterAbort);
      if (reader) {
        try {
          await reader.cancel();
        } catch {
          // stream already closed/errored — nothing to clean up
        }
      }
    }
  }

  /**
   * `reader.read()` on a hand-rolled/test `ReadableStream` does not observe the
   * `AbortSignal` passed to `fetch` (only a real undici-backed network stream does) —
   * race it explicitly so heartbeat-timeout / external-abort paths settle deterministically.
   */
  private readOrAbort<T>(reader: ReadableStreamDefaultReader<T>, signal: AbortSignal) {
    if (signal.aborted)
      return Promise.reject<Awaited<ReturnType<typeof reader.read>>>(
        new DOMException("Aborted", "AbortError"),
      );
    return new Promise<Awaited<ReturnType<typeof reader.read>>>((resolve, reject) => {
      const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
      signal.addEventListener("abort", onAbort, { once: true });
      reader.read().then(
        (v) => {
          signal.removeEventListener("abort", onAbort);
          resolve(v);
        },
        (e) => {
          signal.removeEventListener("abort", onAbort);
          reject(e);
        },
      );
    });
  }
}

@Injectable()
export class GpustackClientFactory {
  async create(baseUrl: string, apiKey: string): Promise<GpustackClient> {
    await assertSafeUrl(baseUrl);
    return new GpustackClient(baseUrl, apiKey);
  }
}
