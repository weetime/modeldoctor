import { Inject, Injectable, Logger } from "@nestjs/common";
import type { AlertEvent, PrometheusDatasource } from "@prisma/client";
import { decodeKey, decrypt } from "../../common/crypto/aes-gcm.js";
import { parseCustomHeaders } from "../../common/http/parse-custom-headers.js";
import { PrismaService } from "../../database/prisma.service.js";
import { PROMETHEUS_DS_ENC_KEY } from "../prometheus-datasource/prometheus-datasource.service.js";
import {
  PROMETHEUS_FETCHER_CONFIG,
  type PrometheusFetcherConfig,
} from "./prometheus-fetcher.config.js";
import { evaluateUrl } from "./prometheus-fetcher.guard.js";

/**
 * Snapshot of Prometheus context surrounding an alert. Returned by
 * `fetchAlertContext`; surfaced to the LLM explainer prompt so the narrative
 * can ground its claims on real datapoints instead of editorialising.
 */
export interface PromContext {
  datasource: { id: string; name: string };
  expr: string;
  window: { start: string; end: string; stepSeconds: number };
  series: Array<{
    labels: Record<string, string>;
    summary: { min: number; max: number; mean: number; last: number };
    samples: Array<{ at: string; value: number }>;
  }>;
}

export interface PromQueryResult {
  datasource: { id: string; name: string };
  query: string;
  kind: "instant" | "range";
  truncated: boolean;
  series: Array<{
    labels: Record<string, string>;
    /** instant queries carry a single `value`; range queries carry `samples`.
     * `null` means a present-but-non-finite Prometheus value ("NaN"/"+Inf"),
     * distinct from "no data" — not a JSON.stringify artifact. */
    value?: number | null;
    samples?: Array<{ at: string; value: number | null }>;
  }>;
}

export type PromQueryOpts =
  | { kind: "instant"; at?: Date }
  | { kind: "range"; from: Date; to: Date; step: number };

// Query window around `startsAt`. We look 15min before for the lead-up and
// 5min after so a recently-firing alert still has at least some post-trigger
// shape to ground the narrative on.
const WINDOW_BEFORE_MS = 15 * 60 * 1000;
const WINDOW_AFTER_MS = 5 * 60 * 1000;
const STEP_SECONDS = 15;
const TIMEOUT_MS = 5_000;
const MAX_SERIES = 5;
const MAX_QUERY_SERIES = 20;
const MAX_SAMPLES_PER_SERIES = 120;

/** Prometheus encodes stale/non-finite values as the strings "NaN" / "+Inf" /
 * "-Inf"; `Number()` turns these into NaN which `JSON.stringify` would silently
 * coerce to `null`. Map them to an explicit `null` so "present-but-non-finite"
 * is distinguishable downstream. */
function finiteOrNull(v: string | undefined | null): number | null {
  // Guard "" / null explicitly: Number("") and Number(null) are both 0, which
  // would mis-map a missing value to a real 0 measurement.
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fetches the metric window referenced by an alert, given the datasource the
 * alert's connection is bound to (or the workspace-default). All failures
 * (no datasource, no expression, network error, decrypt failure) degrade
 * gracefully to `null` so the explainer can still write a baseline-only
 * narrative — the snapshot is best-effort grounding, not a hard requirement.
 */
@Injectable()
export class PrometheusFetcherService {
  private readonly log = new Logger(PrometheusFetcherService.name);
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PROMETHEUS_DS_ENC_KEY) keyB64: string,
    @Inject(PROMETHEUS_FETCHER_CONFIG) private readonly fetcherConfig: PrometheusFetcherConfig,
  ) {
    this.key = decodeKey(keyB64);
  }

  async fetchAlertContext(event: AlertEvent): Promise<PromContext | null> {
    const ds = await this.resolveDatasource(event);
    if (!ds) {
      this.log.debug(`No datasource resolvable for alert ${event.id}`);
      return null;
    }
    const expr = this.resolveExpr(event);
    if (!expr) {
      this.log.debug(`No expr resolvable for alert ${event.id}`);
      return null;
    }
    return this.queryRange(ds, expr, event.startsAt);
  }

  // Test-only access to private resolution helpers. Keeping the production
  // surface narrow (single `fetchAlertContext`) while still exercising each
  // branch in isolation from the unit tests.
  _test_resolveDatasource(event: AlertEvent) {
    return this.resolveDatasource(event);
  }
  _test_resolveExpr(event: AlertEvent) {
    return this.resolveExpr(event);
  }

  /** Resolve a datasource for an MCP query by explicit id, by a connection's
   * binding, or the workspace default. Mirrors the alert-path precedence. */
  async resolveDatasourceByRef(ref: {
    datasourceId?: string;
    connectionId?: string;
  }): Promise<PrometheusDatasource | null> {
    if (ref.datasourceId) {
      return this.prisma.prometheusDatasource.findUnique({ where: { id: ref.datasourceId } });
    }
    if (ref.connectionId) {
      const conn = await this.prisma.connection.findUnique({
        where: { id: ref.connectionId },
        include: { prometheusDatasource: true },
      });
      if (conn?.prometheusDatasource) return conn.prometheusDatasource;
    }
    return this.prisma.prometheusDatasource.findFirst({ where: { isDefault: true } });
  }

  /** Run an arbitrary read-only PromQL query through the same secured fetch
   * path as alert grounding (bearer decrypt + SSRF guard + bounded read). */
  async runQuery(
    ds: PrometheusDatasource,
    query: string,
    opts: PromQueryOpts,
  ): Promise<PromQueryResult> {
    const base = ds.baseUrl.replace(/\/$/, "");
    const url =
      opts.kind === "instant"
        ? new URL(`${base}/api/v1/query`)
        : new URL(`${base}/api/v1/query_range`);
    url.searchParams.set("query", query);
    if (opts.kind === "instant") {
      url.searchParams.set("time", String(Math.floor((opts.at ?? new Date()).getTime() / 1000)));
    } else {
      url.searchParams.set("start", String(Math.floor(opts.from.getTime() / 1000)));
      url.searchParams.set("end", String(Math.floor(opts.to.getTime() / 1000)));
      url.searchParams.set("step", String(opts.step));
    }

    const headers = this.buildAuthHeaders(ds);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await this.safeFetch(url, { headers }, controller.signal);
      if (!res.ok) throw new Error(`prom ${res.status}`);
      const body = (await this.readBoundedJson(res)) as {
        status: string;
        data?: { resultType: string; result?: Array<Record<string, unknown>> };
      } | null;
      if (!body || body.status !== "success" || !body.data?.result) {
        return {
          datasource: { id: ds.id, name: ds.name },
          query,
          kind: opts.kind,
          truncated: false,
          series: [],
        };
      }
      const raw = body.data.result;
      const truncated = raw.length > MAX_QUERY_SERIES;
      const series = raw.slice(0, MAX_QUERY_SERIES).map((row) => {
        const labels = (row.metric as Record<string, string>) ?? {};
        if (opts.kind === "instant") {
          const v = (row.value as [number, string] | undefined)?.[1];
          return { labels, value: finiteOrNull(v) };
        }
        const values = (row.values as Array<[number, string]> | undefined) ?? [];
        return {
          labels,
          samples: values.slice(-MAX_SAMPLES_PER_SERIES).map(([ts, v]) => ({
            at: new Date(ts * 1000).toISOString(),
            value: finiteOrNull(v),
          })),
        };
      });
      return {
        datasource: { id: ds.id, name: ds.name },
        query,
        kind: opts.kind,
        truncated,
        series,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Shared bearer-decrypt + custom-header assembly. NOTE: unlike the private
   * alert `queryRange` (which degrades to null on decrypt failure), this throws
   * a sanitized error — the public `runQuery` contract is throw-on-error and
   * the caller (MCP tool) decides how to surface it. Don't mix the two policies. */
  private buildAuthHeaders(ds: PrometheusDatasource): Record<string, string> {
    const headers: Record<string, string> = {};
    if (ds.bearerCipher) {
      try {
        headers.Authorization = `Bearer ${decrypt(ds.bearerCipher, this.key)}`;
      } catch (e) {
        const err = e as Error;
        this.log.error(`Datasource ${ds.id} bearer decrypt failed: ${err.message}`, err.stack);
        throw new Error(`datasource ${ds.id} bearer decryption failed`);
      }
    }
    const extra = parseCustomHeaders(ds.customHeaders);
    if (extra) Object.assign(headers, extra);
    return headers;
  }

  /**
   * Resolution order:
   * 1. The connection's bound `prometheusDatasource` (explicit override).
   * 2. The workspace default (`isDefault = true`).
   * 3. `null` — caller skips the fetch and degrades gracefully.
   */
  private async resolveDatasource(event: AlertEvent): Promise<PrometheusDatasource | null> {
    if (event.connectionId) {
      const conn = await this.prisma.connection.findUnique({
        where: { id: event.connectionId },
        include: { prometheusDatasource: true },
      });
      if (conn?.prometheusDatasource) return conn.prometheusDatasource;
    }
    return this.prisma.prometheusDatasource.findFirst({ where: { isDefault: true } });
  }

  /**
   * Two-level expression fallback:
   * 1. `annotations.expr` — Prometheus' standard rule-level annotation that
   *    Alertmanager carries through verbatim.
   * 2. `generatorURL?g0.expr=` — the URL Prometheus links to in the web UI,
   *    always populated even when the rule omits the explicit annotation.
   */
  private resolveExpr(event: AlertEvent): string | null {
    const annoExpr = (event.annotations as Record<string, unknown> | null)?.expr;
    if (typeof annoExpr === "string" && annoExpr.length > 0) return annoExpr;
    const url = (event.rawPayload as Record<string, unknown> | null)?.generatorURL;
    if (typeof url === "string") {
      try {
        const parsed = new URL(url);
        const expr = parsed.searchParams.get("g0.expr");
        if (expr) return expr;
      } catch {
        return null;
      }
    }
    return null;
  }

  private async queryRange(
    ds: PrometheusDatasource,
    expr: string,
    startsAt: Date,
  ): Promise<PromContext | null> {
    const start = new Date(startsAt.getTime() - WINDOW_BEFORE_MS);
    const end = new Date(startsAt.getTime() + WINDOW_AFTER_MS);
    const url = new URL(`${ds.baseUrl.replace(/\/$/, "")}/api/v1/query_range`);
    url.searchParams.set("query", expr);
    url.searchParams.set("start", String(Math.floor(start.getTime() / 1000)));
    url.searchParams.set("end", String(Math.floor(end.getTime() / 1000)));
    url.searchParams.set("step", String(STEP_SECONDS));

    const headers: Record<string, string> = {};
    if (ds.bearerCipher) {
      try {
        headers.Authorization = `Bearer ${decrypt(ds.bearerCipher, this.key)}`;
      } catch (e) {
        // Surface the stack so an admin can tell whether this is a key-mismatch
        // (env rotated without re-encrypting) vs corrupted cipher vs algorithm
        // mismatch — `log.warn` alone left the catch site blind.
        const err = e as Error;
        this.log.error(`Datasource ${ds.id} bearer decrypt failed: ${err.message}`, err.stack);
        return null;
      }
    }
    const extra = parseCustomHeaders(ds.customHeaders);
    if (extra) Object.assign(headers, extra);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await this.safeFetch(url, { headers }, controller.signal);
      if (!res.ok) {
        this.log.warn(`Prom query_range ${res.status} for ${ds.name}`);
        return null;
      }
      const body = (await this.readBoundedJson(res)) as {
        status: string;
        data?: {
          result?: Array<{
            metric: Record<string, string>;
            values: Array<[number, string]>;
          }>;
        };
      } | null;
      if (!body) return null;
      if (body.status !== "success" || !body.data?.result) return null;
      return {
        datasource: { id: ds.id, name: ds.name },
        expr,
        window: {
          start: start.toISOString(),
          end: end.toISOString(),
          stepSeconds: STEP_SECONDS,
        },
        series: body.data.result.slice(0, MAX_SERIES).map((s) => this.summariseSeries(s)),
      };
    } catch (e) {
      this.log.warn(`Prom query_range failed for ${ds.name}: ${(e as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async safeFetch(
    initialUrl: URL,
    init: RequestInit,
    signal: AbortSignal,
  ): Promise<Response> {
    // Allow the initial fetch + up to 2 redirect hops = 3 fetches total.
    const MAX_FETCHES = 3;
    let url = initialUrl;
    for (let attempt = 0; attempt < MAX_FETCHES; attempt++) {
      const verdict = await evaluateUrl(url, this.fetcherConfig.guard);
      if (!verdict.ok) {
        throw new Error(`prom-fetcher refused ${url.href}: ${verdict.reason}`);
      }
      const res = await fetch(url, { ...init, redirect: "manual", signal });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        // Cancel the body stream rather than reading it: redirects rarely
        // carry a meaningful body, and a malicious server could otherwise
        // ship gigabytes here as a DoS. cancel() releases the underlying
        // socket without buffering anything.
        await res.body?.cancel().catch(() => undefined);
        if (!loc) return res; // 3xx without Location — let caller handle.
        if (attempt === MAX_FETCHES - 1) {
          throw new Error(`prom-fetcher exceeded ${MAX_FETCHES - 1} redirect hops`);
        }
        url = new URL(loc, url);
        continue;
      }
      return res;
    }
    // Unreachable — the loop either returns or throws.
    throw new Error("prom-fetcher safeFetch internal error");
  }

  private async readBoundedJson(res: Response): Promise<unknown> {
    if (!res.body) return null;
    const max = this.fetcherConfig.maxBodyBytes;
    const reader = res.body.getReader();
    let received = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > max) {
        // cancel() releases the underlying socket without buffering more.
        await reader.cancel();
        throw new Error(`prom-fetcher response exceeded ${max} bytes`);
      }
      chunks.push(value);
    }
    const text = Buffer.concat(chunks).toString("utf-8");
    // Empty body (e.g. 204 / misbehaving 200) → null; caller already
    // guards on the null-from-readBoundedJson path.
    if (!text) return null;
    return JSON.parse(text);
  }

  /**
   * Reduce a raw matrix series into stats + a handful of representative
   * samples (first, peak deviation from mean, last 3). Keeps the prompt
   * payload bounded — the LLM doesn't need every 15s sample to ground its
   * claims, just enough to anchor the narrative.
   */
  private summariseSeries(s: { metric: Record<string, string>; values: Array<[number, string]> }) {
    const nums = s.values.map(([ts, v]) => ({
      at: new Date(ts * 1000).toISOString(),
      value: Number(v),
    }));
    const finite = nums.filter((n) => Number.isFinite(n.value));
    if (finite.length === 0) {
      return {
        labels: s.metric,
        summary: { min: Number.NaN, max: Number.NaN, mean: Number.NaN, last: Number.NaN },
        samples: [] as Array<{ at: string; value: number }>,
      };
    }
    const vals = finite.map((n) => n.value);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const last = vals[vals.length - 1] ?? Number.NaN;
    const peakIdx = vals.reduce(
      (best, v, i) => (Math.abs(v - mean) > Math.abs((vals[best] ?? 0) - mean) ? i : best),
      0,
    );
    const first = finite[0];
    const peak = finite[peakIdx];
    const tail = finite.slice(-3);
    const candidates = [...(first ? [first] : []), ...(peak ? [peak] : []), ...tail];
    const samples = candidates.filter((v, i, arr) => arr.findIndex((x) => x.at === v.at) === i);
    return {
      labels: s.metric,
      summary: { min, max, mean, last },
      samples,
    };
  }
}
