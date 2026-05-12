"""KV-cache backend stress benchmark.

Multi-turn dialog workload that forces prefix-cache evictions so different
KV cache backends (LMCache / YRCache / vanilla) produce comparable
QPS / TTFT / Prefix-Cache-Savings deltas.

Workload methodology (adapted from theriseunion/repots:2026-05-10 + 2026-05-11):
- NUM_SESSIONS unique sessions, each with a ~2000-token system prompt
  derived deterministically from sha256(systemPromptSeed + session-id).
  Same input across runs → reproducible prefix-cache hits.
- TURNS multi-turn dialog per session, history accumulates so turns 2+
  hit prefix cache.
- CONCURRENCY async workers, each pick a random session per request.
- Per-request streaming + stream_options.include_usage so we capture
  TTFT from the FIRST content delta (not the SSE role chunk).

Output: --out is a JSON file matching kvCacheStressReportSchema in
packages/tool-adapters/src/kv-cache-stress/schema.ts.

CLI: see argparse below. OPENAI_API_KEY env var carries the bearer token.

Prometheus integration (optional, --prom-url):
- Before/after counter snapshot of vllm:prefix_cache_hits_total,
  vllm:prefix_cache_queries_total, vllm:prompt_tokens_total,
  vllm:prompt_tokens_cached_total, vllm:generation_tokens_total.
- Handles V0 (vllm:gpu_*) and V1 (vllm:*) metric names like
  prefix_cache_probe.py does.

Backend native counters (scraped via the same vLLM /metrics endpoint that
already aggregates lmcache:* / yrcache_* through PROMETHEUS_MULTIPROC_DIR):
- Heuristic detects whether lmcache:* or yrcache_* counters appear and
  reports `backend.nameGuess`. Both counter families dumped as a flat
  record so the FE can show them without per-backend knowledge.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import random
import sys
import time
from pathlib import Path
from typing import Any

import httpx

QUESTIONS = [
    "State your analysis.",
    "Continue your reasoning.",
    "What is the conclusion?",
    "What are the next steps?",
    "Summarise the key points.",
    "Highlight the trade-offs.",
    "Propose follow-up actions.",
    "Identify open questions.",
]


def make_scenario(idx: int, seed: str) -> str:
    seed_bytes = hashlib.sha256(f"{seed}-{idx}".encode()).hexdigest()[:16]
    head = (
        f"You are senior expert {seed_bytes}. Provide concise structured "
        f"analysis. Each response should be brief and direct."
    )
    refs = "\n".join(
        f"REF[{seed_bytes}-{j:03d}] context: data point #{j} about scenario "
        f"{idx} domain detail elaboration here."
        for j in range(150)
    )
    return f"{head}\n\n{refs}"


async def session_run(
    client: httpx.AsyncClient,
    base_path: str,
    model: str,
    sess_id: int,
    turns: int,
    max_tokens: int,
    seed: str,
) -> list[tuple]:
    history: list[dict[str, str]] = [{"role": "system", "content": make_scenario(sess_id, seed)}]
    rows: list[tuple] = []
    for turn in range(turns):
        history.append({"role": "user", "content": QUESTIONS[turn % len(QUESTIONS)]})
        body = {
            "model": model,
            "messages": history,
            "stream": True,
            "stream_options": {"include_usage": True},
            "max_tokens": max_tokens,
            "chat_template_kwargs": {"enable_thinking": False},
        }
        t0 = time.time()
        ttft: float | None = None
        content = ""
        pt = 0
        ct = 0
        try:
            async with client.stream("POST", base_path, json=body, timeout=120) as resp:
                if resp.status_code != 200:
                    rows.append(
                        (
                            "err_http",
                            resp.status_code,
                            sess_id,
                            turn,
                            0,
                            0,
                            0.0,
                            time.time() - t0,
                        )
                    )
                    return rows
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    p = line[5:].strip()
                    if p == "[DONE]":
                        break
                    try:
                        d = json.loads(p)
                    except Exception:
                        continue
                    if d.get("choices"):
                        delta = d["choices"][0].get("delta", {}).get("content", "") or ""
                        if delta and ttft is None:
                            ttft = time.time() - t0
                        content += delta
                    if d.get("usage"):
                        pt = d["usage"].get("prompt_tokens", pt)
                        ct = d["usage"].get("completion_tokens", ct)
            elapsed = time.time() - t0
            history.append({"role": "assistant", "content": content})
            rows.append(("ok", sess_id, turn, pt, ct, ttft or 0.0, elapsed))
        except Exception as e:
            elapsed = time.time() - t0
            rows.append(
                (
                    f"err_exc:{type(e).__name__}",
                    sess_id,
                    turn,
                    0,
                    0,
                    0.0,
                    elapsed,
                )
            )
            break
    return rows


async def worker(
    base_url: str,
    api_key: str,
    model: str,
    num_sessions: int,
    turns: int,
    max_tokens: int,
    seed: str,
    deadline: float,
    results: list,
    lock: asyncio.Lock,
) -> None:
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    async with httpx.AsyncClient(
        base_url=base_url,
        headers=headers,
        timeout=httpx.Timeout(120.0, connect=10.0),
    ) as client:
        path = "/v1/chat/completions"
        while time.time() < deadline:
            sess_id = random.randrange(num_sessions)
            rows = await session_run(client, path, model, sess_id, turns, max_tokens, seed)
            async with lock:
                results.extend(rows)


async def progress_loop(start: float, deadline: float, results: list) -> None:
    while time.time() < deadline:
        await asyncio.sleep(15)
        ok = sum(1 for r in results if r[0] == "ok")
        err = len(results) - ok
        ct = sum(r[4] for r in results if r[0] == "ok")
        elapsed = int(time.time() - start)
        # Format matches the regex in kv-cache-stress/runtime.ts parseProgress.
        print(
            f"  +{elapsed:>3}s  ok={ok}  err={err}  completion_tokens={ct}",
            flush=True,
        )


def percentile(arr: list[float], p: float) -> float:
    if not arr:
        return 0.0
    idx = min(len(arr) - 1, int(len(arr) * p / 100))
    return arr[idx]


async def snapshot_prom_counter(prom: str, metric: str, model: str) -> int:
    """Sum a vllm:* counter across all series with the matching model_name.
    Falls back to V0 vllm:gpu_<metric>* if V1 returns nothing.
    """
    query = (
        f'sum(vllm:{metric}{{model_name="{model}"}}) '
        f'or sum(vllm:gpu_{metric}{{model_name="{model}"}})'
    )
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(f"{prom}/api/v1/query", params={"query": query})
            r.raise_for_status()
            result = r.json().get("data", {}).get("result", [])
        if not result:
            return 0
        return int(float(result[0]["value"][1]))
    except Exception as e:
        print(f"[prom] failed to query {metric}: {e}", file=sys.stderr)
        return 0


async def snapshot_prom_all(prom: str | None, model: str) -> dict[str, int]:
    """Returns delta-source counters: {metric_name: value}. {} when prom URL
    is empty or scrape failed entirely (caller treats as no-Prom-data)."""
    if not prom:
        return {}
    metrics = [
        "prefix_cache_hits_total",
        "prefix_cache_queries_total",
        "prompt_tokens_total",
        "prompt_tokens_cached_total",
        "generation_tokens_total",
    ]
    out: dict[str, int] = {}
    for m in metrics:
        out[m] = await snapshot_prom_counter(prom.rstrip("/"), m, model)
    return out


async def scrape_backend_counters(base_url: str, api_key: str) -> tuple[str, dict[str, float]]:
    """Scrape vLLM /metrics and pull lmcache:* / yrcache_* counters.
    Returns (nameGuess, {metric_name_with_labels: value}). Aggregates across
    label sets per metric name (summing) to match the diff scripts shipped
    in theriseunion/repots."""
    url = base_url.rstrip("/") + "/metrics"
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    try:
        async with httpx.AsyncClient(timeout=15, headers=headers) as client:
            r = await client.get(url)
            r.raise_for_status()
        body = r.text
    except Exception as e:
        print(f"[backend] failed to scrape /metrics: {e}", file=sys.stderr)
        return "unknown", {}

    lmcache: dict[str, float] = {}
    yrcache: dict[str, float] = {}
    for raw in body.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        # Family-detect by prefix; strip labels for aggregation key.
        if line.startswith("lmcache:") or line.startswith("yrcache_"):
            try:
                name, value = line.rsplit(" ", 1)
            except ValueError:
                continue
            base = name.split("{", 1)[0]
            try:
                v = float(value)
            except ValueError:
                continue
            target = lmcache if line.startswith("lmcache:") else yrcache
            target[base] = target.get(base, 0.0) + v

    if lmcache and not yrcache:
        return "lmcache", lmcache
    if yrcache and not lmcache:
        return "yrcache", yrcache
    if yrcache and lmcache:
        # Both present (e.g. images shipping both libs); pick the one with
        # more activity. Tie-break favours yrcache because lmcache_*
        # registers ~30 zero gauges that always count.
        if sum(yrcache.values()) >= sum(lmcache.values()):
            return "yrcache", yrcache
        return "lmcache", lmcache
    return "unknown", {}


async def main_async(args: argparse.Namespace) -> int:
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        print("[stress] WARN: OPENAI_API_KEY not set; sending unauthenticated", file=sys.stderr)

    print(f"BASE_URL={args.base_url}  MODEL={args.model}  API_KEY={'set' if api_key else 'unset'}")
    print(
        f"NUM_SESSIONS={args.num_sessions}  TURNS={args.turns}  "
        f"CONCURRENCY={args.concurrency}  MAX_TOKENS={args.max_tokens}  "
        f"DURATION={args.duration}s"
    )
    print(f"OUT={args.out}")
    print()

    # Optional pre-bench Prom snapshot.
    prom_before = await snapshot_prom_all(args.prom_url, args.model)

    start = time.time()
    deadline = start + args.duration
    results: list[tuple] = []
    lock = asyncio.Lock()
    workers = [
        asyncio.create_task(
            worker(
                args.base_url,
                api_key,
                args.model,
                args.num_sessions,
                args.turns,
                args.max_tokens,
                args.system_prompt_seed,
                deadline,
                results,
                lock,
            )
        )
        for _ in range(args.concurrency)
    ]
    progress = asyncio.create_task(progress_loop(start, deadline, results))
    await asyncio.gather(*workers, return_exceptions=True)
    progress.cancel()

    wall = time.time() - start

    # Optional post-bench Prom snapshot.
    prom_after = await snapshot_prom_all(args.prom_url, args.model)

    backend_name, backend_counters = await scrape_backend_counters(args.base_url, api_key)

    ok_rows = [r for r in results if r[0] == "ok"]
    err_count = len(results) - len(ok_rows)
    total = len(results)
    ttfts = sorted(r[5] * 1000.0 for r in ok_rows)
    elapsed = sorted(r[6] * 1000.0 for r in ok_rows)
    pt_sum = sum(r[3] for r in ok_rows)
    ct_sum = sum(r[4] for r in ok_rows)

    prom_block: dict[str, Any] = {}
    if prom_before and prom_after:
        delta_q = max(
            0,
            prom_after.get("prefix_cache_queries_total", 0)
            - prom_before.get("prefix_cache_queries_total", 0),
        )
        delta_h = max(
            0,
            prom_after.get("prefix_cache_hits_total", 0)
            - prom_before.get("prefix_cache_hits_total", 0),
        )
        delta_pt = max(
            0,
            prom_after.get("prompt_tokens_total", 0) - prom_before.get("prompt_tokens_total", 0),
        )
        delta_cached = max(
            0,
            prom_after.get("prompt_tokens_cached_total", 0)
            - prom_before.get("prompt_tokens_cached_total", 0),
        )
        delta_gen = max(
            0,
            prom_after.get("generation_tokens_total", 0)
            - prom_before.get("generation_tokens_total", 0),
        )
        if delta_q > 0:
            prom_block["hbmHitRatePct"] = round(100.0 * delta_h / delta_q, 2)
        if delta_pt > 0:
            prom_block["prefixCacheSavingsPct"] = round(100.0 * delta_cached / delta_pt, 2)
        prom_block["promptTokensTotalDelta"] = delta_pt
        prom_block["generationTokensTotalDelta"] = delta_gen

    report: dict[str, Any] = {
        "qps": round(len(ok_rows) / wall, 3) if wall > 0 else 0.0,
        "outputTps": round(ct_sum / wall, 2) if wall > 0 else 0.0,
        "requestsOk": len(ok_rows),
        "requestsErr": err_count,
        "errRatePct": round(100.0 * err_count / total, 2) if total else 0.0,
        "ttftMs": {
            "p50": round(percentile(ttfts, 50), 1),
            "p90": round(percentile(ttfts, 90), 1),
            "p99": round(percentile(ttfts, 99), 1),
        },
        "e2eMs": {
            "p50": round(percentile(elapsed, 50), 1),
            "p90": round(percentile(elapsed, 90), 1),
            "p99": round(percentile(elapsed, 99), 1),
        },
        "prom": prom_block,
        "backend": {
            "nameGuess": backend_name,
            "counters": backend_counters,
        },
    }

    Path(args.out).write_text(json.dumps(report, indent=2), encoding="utf-8")

    print()
    print("=== SUMMARY ===")
    print(f"requests_ok        = {report['requestsOk']}")
    print(f"requests_err       = {report['requestsErr']}")
    print(f"sum_prompt_tokens  = {pt_sum}")
    print(f"sum_completion_tok = {ct_sum}")
    print(f"qps                = {report['qps']}")
    print(f"output_tps         = {report['outputTps']}")
    print(
        "ttft_ms p50/p90/p99 = "
        f"{report['ttftMs']['p50']:.0f}/{report['ttftMs']['p90']:.0f}/"
        f"{report['ttftMs']['p99']:.0f}"
    )
    print(
        "e2e_ms  p50/p90/p99 = "
        f"{report['e2eMs']['p50']:.0f}/{report['e2eMs']['p90']:.0f}/"
        f"{report['e2eMs']['p99']:.0f}"
    )
    print(f"backend.nameGuess  = {report['backend']['nameGuess']}")
    if prom_block.get("prefixCacheSavingsPct") is not None:
        print(f"prefix_cache_savings_pct = {prom_block['prefixCacheSavingsPct']}")

    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--base-url", required=True, help="OpenAI-compatible base URL (no /v1/...)")
    p.add_argument("--model", required=True)
    p.add_argument("--num-sessions", type=int, required=True)
    p.add_argument("--turns", type=int, required=True)
    p.add_argument("--concurrency", type=int, required=True)
    p.add_argument("--max-tokens", type=int, required=True)
    p.add_argument("--duration", type=int, required=True, help="bench wall-clock seconds")
    p.add_argument("--system-prompt-seed", required=True)
    p.add_argument(
        "--prom-url", default=None, help="Optional Prometheus base URL for delta snapshot"
    )
    p.add_argument("--out", default="result.json")
    args = p.parse_args()
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    sys.exit(main())
