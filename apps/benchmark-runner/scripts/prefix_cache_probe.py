"""Prefix-cache stickiness probe.

Sends N rounds of M same-prefix requests to a chat-completion endpoint
and reads vLLM gpu_prefix_cache_queries_total deltas from Prometheus to
determine which pod served each round. Outputs a per-round summary plus
aggregate stickinessPct.

Critical methodology (handoff §5):
- Each HTTP request uses its OWN httpx.AsyncClient + Connection: close.
  Reusing a single client pins the kernel TCP socket → Envoy LB sees one
  upstream regardless of plugin behavior. Independent clients let
  ai-load-balancer make a per-request decision.
- After each round, sleep promBackoffSec (>= 15s = Prom default scrape
  interval) before the second snapshot, otherwise delta is zero.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from typing import Any

import httpx

# Five fixed long prompts. Each is ~500 tokens so vLLM's prefix-cache block
# slicing kicks in. Indexed by --rounds [0..N-1]; --rounds capped at 5 by
# packages/tool-adapters/src/prefix-cache-probe/schema.ts.
PROMPTS: list[str] = [
    "I am building a distributed key-value store using Raft consensus. " * 30,
    "Our team is migrating a monolithic Java application to microservices. " * 30,
    "Distributed Postgres replication with logical decoding for cross-region. " * 30,
    "Modern frontend React server components and streaming SSR architectures. " * 30,
    "Kubernetes operator pattern for stateful workloads with custom CRDs. " * 30,
]


async def send_one(
    url: str,
    api_key: str,
    model: str,
    prompt: str,
    discriminator: str,
    max_tokens: int,
) -> bool:
    """One request with its own httpx client (forces TCP reconnect)."""
    body = {
        "model": model,
        "messages": [
            {"role": "user", "content": prompt},
            {"role": "user", "content": discriminator},
        ],
        "max_tokens": max_tokens,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Connection": "close",
    }
    try:
        async with httpx.AsyncClient(http2=False, timeout=120) as client:
            r = await client.post(url, json=body, headers=headers)
            return r.status_code == 200
    except Exception as e:
        print(f"[probe] request failed: {e}", file=sys.stderr)
        return False


async def snapshot_prom(prom: str, metric: str) -> dict[str, int]:
    """Returns {pod -> int(value)}. 'pod' label comes from kube-state-metrics
    relabel; if absent we fall back to 'instance'."""
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{prom}/api/v1/query", params={"query": metric})
        r.raise_for_status()
        result = r.json()["data"]["result"]
    out: dict[str, int] = {}
    for item in result:
        m = item["metric"]
        key = m.get("pod") or m.get("instance") or "?"
        out[key] = int(float(item["value"][1]))
    return out


def diff_snapshots(before: dict[str, int], after: dict[str, int]) -> dict[str, int]:
    # Clamp at 0: a vLLM pod restart resets the counter so after < before is
    # possible. Reporting negative deltas would violate the report schema's
    # nonnegative() constraint and skew dominant_pct math.
    pods = set(before) | set(after)
    return {p: max(0, after.get(p, 0) - before.get(p, 0)) for p in pods}


async def run_round(
    label: str,
    url: str,
    api_key: str,
    model: str,
    prompt: str,
    requests: int,
    max_tokens: int,
    prom: str,
    backoff: int,
) -> dict[str, Any]:
    """Sends `requests` same-prefix requests, returns per-pod delta."""
    queries_metric = "vllm:gpu_prefix_cache_queries_total"
    hits_metric = "vllm:gpu_prefix_cache_hits_total"

    before_q = await snapshot_prom(prom, queries_metric)
    before_h = await snapshot_prom(prom, hits_metric)

    tasks = [
        send_one(url, api_key, model, prompt, f"{label}-q{i}", max_tokens)
        for i in range(requests)
    ]
    results = await asyncio.gather(*tasks)
    succeeded = sum(1 for ok in results if ok)

    print(f"[probe] {label}: {succeeded}/{requests} succeeded; sleeping {backoff}s for Prom scrape")
    await asyncio.sleep(backoff)

    after_q = await snapshot_prom(prom, queries_metric)
    after_h = await snapshot_prom(prom, hits_metric)

    delta_q = diff_snapshots(before_q, after_q)
    delta_h = diff_snapshots(before_h, after_h)

    total = sum(delta_q.values())
    if total == 0:
        # No delta visible — Prom scrape hasn't caught up, or vLLM doesn't
        # expose this metric (prefix caching disabled?). Mark dominantPct=0
        # so the front-end can flag it.
        dominant_pod = "unknown"
        dominant_pct = 0.0
    else:
        dominant_pod = max(delta_q, key=delta_q.get)  # type: ignore[arg-type]
        dominant_pct = 100.0 * delta_q[dominant_pod] / total

    return {
        "label": label,
        "dominantPod": dominant_pod,
        "dominantPct": round(dominant_pct, 2),
        "totalRequests": total,
        "deltaQueries": delta_q,
        "deltaHits": delta_h,
    }


async def main_async(args: argparse.Namespace) -> int:
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        print("[probe] OPENAI_API_KEY not set in env", file=sys.stderr)
        return 2

    chat_url = args.url.rstrip("/") + "/v1/chat/completions"

    if args.rounds > len(PROMPTS):
        print(
            f"[probe] --rounds {args.rounds} exceeds bundled prompt count {len(PROMPTS)}",
            file=sys.stderr,
        )
        return 2

    rounds: list[dict[str, Any]] = []
    for i in range(args.rounds):
        rounds.append(
            await run_round(
                label=f"set-{i}",
                url=chat_url,
                api_key=api_key,
                model=args.model,
                prompt=PROMPTS[i],
                requests=args.requests,
                max_tokens=args.max_tokens,
                prom=args.prom.rstrip("/"),
                backoff=args.backoff,
            )
        )

    # Aggregate per-pod across all rounds
    per_pod: dict[str, dict[str, int]] = {}
    for r in rounds:
        for pod, dq in r["deltaQueries"].items():
            per_pod.setdefault(pod, {"queries": 0, "hits": 0})
            per_pod[pod]["queries"] += dq
        for pod, dh in r["deltaHits"].items():
            per_pod.setdefault(pod, {"queries": 0, "hits": 0})
            per_pod[pod]["hits"] += dh

    # stickinessPct = unweighted mean of dominantPct across rounds
    stickiness = sum(r["dominantPct"] for r in rounds) / len(rounds) if rounds else 0.0

    # deterministic = each round had >= 90% on a single pod
    deterministic = all(r["dominantPct"] >= 90.0 for r in rounds)

    out = {
        "stickinessPct": round(stickiness, 2),
        "deterministic": deterministic,
        "perPod": [
            {"pod": p, "queries": v["queries"], "hits": v["hits"]}
            for p, v in sorted(per_pod.items())
        ],
        "promptSets": [
            {
                "label": r["label"],
                "dominantPod": r["dominantPod"],
                "dominantPct": r["dominantPct"],
                "totalRequests": r["totalRequests"],
            }
            for r in rounds
        ],
    }

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2)
    print(f"[probe] wrote {args.out}: stickinessPct={out['stickinessPct']}%")
    return 0


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--url", required=True, help="OpenAI-compatible base URL (no /v1/...)")
    p.add_argument("--prom", required=True, help="Prometheus base URL")
    p.add_argument("--model", required=True)
    p.add_argument("--rounds", type=int, required=True)
    p.add_argument("--requests", type=int, required=True)
    p.add_argument("--max-tokens", type=int, required=True)
    p.add_argument("--backoff", type=int, required=True)
    p.add_argument("--out", default="result.json")
    args = p.parse_args()
    return asyncio.run(main_async(args))


if __name__ == "__main__":
    sys.exit(main())
