"""Omni sweep driver: 瘦客户端直接压全模态端点,扫 双臂 × 并发档,聚合写
out/omni_result.json(形状 = vllmOmniBenchReportSchema)。

**不依赖 vllm-omni bench**:业内压语音输出(TTFA/RTF)本就是客户端从流式响应
直接算的(Gladia/Picovoice/GIGAGPU 均如此),无需 20GiB 重镜像、无需 tokenizer。
本 driver 用 httpx 发 OpenAI chat completions 流式请求,从 delta 首包 + base64
WAV 时长算指标,asyncio 做并发。

由通用 wrapper 以工具 argv 启动: python -m runner.tools.omni_driver
契约(packages/tool-adapters/src/vllm-omni-bench/runtime.ts 写入):
  MD_OMNI_PARAMS   params JSON(concurrencyLevels/inputTokens/outputTokens/
                   voiceTax/numWarmups/perPointTimeoutSeconds)
  MD_OMNI_BASE_URL 上游 base URL(无尾斜杠)
  MD_OMNI_MODEL    served model 名
  OPENAI_API_KEY   (secretEnv) Bearer token
方法学纪律(写死): 双臂同 prompt + max_tokens、ignore_eos、每档 max(4, 2×c) 个测量请求。
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import os
import statistics
import sys
import time
import wave
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="[omni-driver] %(message)s")
log = logging.getLogger("omni-driver")

OUT_DIR = Path("out")
RESULT_FILE = OUT_DIR / "omni_result.json"
ENDPOINT = "/v1/chat/completions"

# 固定朗读 prompt(音频臂让模型出语音;双臂共用以保证公平)。inputTokens 用
# 填充词近似放大输入体量(无 tokenizer,不追求精确 token 数——RTF 只与输出音频
# 时长相关,输入长度主要影响 TTFT/prefill)。
_BASE_PROMPT = "请朗读下面这段话,用自然的语气:人工智能正在改变世界。"
_FILLER = "这是一段用于填充输入长度的中性文本。"


def build_prompt(input_tokens: int) -> str:
    """近似 input_tokens 规模的 prompt(CJK ~1 token/char)。"""
    if input_tokens <= len(_BASE_PROMPT):
        return _BASE_PROMPT
    pad_chars = input_tokens - len(_BASE_PROMPT)
    reps = pad_chars // len(_FILLER) + 1
    return _BASE_PROMPT + (_FILLER * reps)[:pad_chars]


def _wav_duration_seconds(b64: str) -> float:
    """解 base64 WAV,返回时长秒。非法/非 WAV 返回 0。"""
    try:
        raw = base64.b64decode(b64)
        with wave.open(io.BytesIO(raw)) as w:
            return w.getnframes() / float(w.getframerate())
    except Exception:
        return 0.0


def _pct(values: list[float]) -> dict[str, float] | None:
    """mean/p50/p99 三件套(与 bench 的 --percentile-metrics 口径对齐)。"""
    if not values:
        return None
    s = sorted(values)
    return {
        "mean": round(statistics.fmean(s), 2),
        "p50": round(_percentile(s, 0.50), 2),
        "p99": round(_percentile(s, 0.99), 2),
    }


def _percentile(sorted_vals: list[float], q: float) -> float:
    if not sorted_vals:
        return 0.0
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    idx = q * (len(sorted_vals) - 1)
    lo = int(idx)
    hi = min(lo + 1, len(sorted_vals) - 1)
    frac = idx - lo
    return sorted_vals[lo] * (1 - frac) + sorted_vals[hi] * frac


def build_body(model: str, arm: str, params: dict) -> dict:
    """一次请求的 JSON body。音频臂 modalities=[text,audio],文本臂 [text]。"""
    modalities = ["text", "audio"] if arm == "audio" else ["text"]
    return {
        "model": model,
        "messages": [{"role": "user", "content": build_prompt(params["inputTokens"])}],
        "max_tokens": params["outputTokens"],
        "stream": True,
        "stream_options": {"include_usage": True},
        "modalities": modalities,
        "ignore_eos": True,
    }


async def one_request(client, base_url: str, headers: dict, body: dict, arm: str) -> dict | None:
    """发一次流式请求,算单请求指标;失败(HTTP 错/异常/音频臂无音频)返回 None。

    返回 {ttftMs, e2elMs, audioTtfpMs|None, audioRtfSec|None, completionTokens|None}。
    """
    t0 = time.perf_counter()
    ttft = None
    ttfa = None
    audio_dur = 0.0
    completion_tokens = None
    try:
        async with client.stream("POST", base_url + ENDPOINT, headers=headers, json=body) as resp:
            if resp.status_code != 200:
                body = (await resp.aread()).decode(errors="replace")[:200]
                log.warning("HTTP %d from endpoint: %s", resp.status_code, body)
                return None
            async for line in resp.aiter_lines():
                line = line.strip()
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    break
                try:
                    obj = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                usage = obj.get("usage")
                if usage and usage.get("completion_tokens") is not None:
                    completion_tokens = usage["completion_tokens"]
                choices = obj.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                content = delta.get("content")
                if not content:
                    continue
                modality = obj.get("modality")
                if modality == "audio":
                    if ttfa is None:
                        ttfa = time.perf_counter() - t0
                    audio_dur += _wav_duration_seconds(content)
                else:  # text (modality 缺省也当文本)
                    if ttft is None:
                        ttft = time.perf_counter() - t0
    except Exception as e:  # noqa: BLE001 - 单请求失败判失败点,不炸整档
        log.debug("request failed: %s", e)
        return None

    e2el = time.perf_counter() - t0
    if ttft is None:
        return None  # 连文本都没出 → 判失败
    if arm == "audio" and (ttfa is None or audio_dur <= 0):
        return None  # 音频臂但没解出音频 → 判失败(端点没回音频)
    return {
        "ttftMs": ttft * 1000.0,
        "e2elMs": e2el * 1000.0,
        "audioTtfpMs": (ttfa * 1000.0) if ttfa is not None else None,
        "audioRtfSec": (e2el / audio_dur) if audio_dur > 0 else None,
        "completionTokens": completion_tokens,
    }


def aggregate_point(reqs: list[dict], arm: str, batch_wall: float) -> dict:
    """一档的 ok 单请求列表 → curve point 数值部分。"""
    n = len(reqs)
    tok = [r["completionTokens"] for r in reqs if r["completionTokens"] is not None]
    return {
        "reqPerSec": round(n / batch_wall, 4) if batch_wall > 0 else 0.0,
        "outTokPerSec": round(sum(tok) / batch_wall, 2) if tok and batch_wall > 0 else 0.0,
        "ttftMs": _pct([r["ttftMs"] for r in reqs]),
        "e2elMs": _pct([r["e2elMs"] for r in reqs]),
        "audioTtfpMs": _pct([r["audioTtfpMs"] for r in reqs if r["audioTtfpMs"] is not None])
        if arm == "audio"
        else None,
        "audioRtf": _pct([r["audioRtfSec"] for r in reqs if r["audioRtfSec"] is not None])
        if arm == "audio"
        else None,
    }


async def run_point(client, base_url, headers, model, arm, concurrency, params) -> dict | None:
    """跑一档(warmup + 测量),聚合;全失败返回 None。"""
    body = build_body(model, arm, params)
    sem = asyncio.Semaphore(concurrency)

    async def guarded():
        async with sem:
            return await one_request(client, base_url, headers, body, arm)

    # warmup(不计入指标)
    if params["numWarmups"] > 0:
        await asyncio.gather(
            *[guarded() for _ in range(params["numWarmups"])], return_exceptions=True
        )

    n_measured = max(4, 2 * concurrency)
    t_batch = time.perf_counter()
    results = await asyncio.gather(*[guarded() for _ in range(n_measured)], return_exceptions=True)
    batch_wall = time.perf_counter() - t_batch
    ok = [r for r in results if isinstance(r, dict)]
    if not ok:
        return None
    return aggregate_point(ok, arm, batch_wall)


def _make_client(timeout: int):
    """httpx.AsyncClient(懒导入,单测 mock one_request 时无需装 httpx)。

    连接池必须无上限:并发档可达 512,而 httpx 默认 max_connections=100 会让
    超出的请求在客户端排队;t0 在 client.stream 之前打,排队时间会算进
    TTFT/e2el,恰在高并发区(找实时天花板的关键)扭曲结果。
    """
    import httpx

    limits = httpx.Limits(max_connections=None, max_keepalive_connections=None)
    return httpx.AsyncClient(timeout=httpx.Timeout(timeout), limits=limits)


def compute_derived(points: list[dict]) -> dict:
    audio_ok = [p for p in points if p["arm"] == "audio" and p["status"] == "ok"]
    realtime = [p["concurrency"] for p in audio_ok if p["audioRtf"] and p["audioRtf"]["mean"] < 1.0]
    ceiling = max(realtime) if realtime else 0
    text_by_c = {p["concurrency"]: p for p in points if p["arm"] == "text" and p["status"] == "ok"}
    tax: dict[str, float] = {}
    for p in audio_ok:
        t = text_by_c.get(p["concurrency"])
        if t and p["e2elMs"] and t["e2elMs"]:
            tax[str(p["concurrency"])] = round(p["e2elMs"]["mean"] - t["e2elMs"]["mean"], 1)
    shared = [int(k) for k in tax]
    return {
        "realtimeCeiling": ceiling,
        "peakConcurrency": ceiling,
        "voiceTaxMsByLevel": tax,
        "voiceTaxMs": tax[str(max(shared))] if shared else None,
    }


def _failed_point(arm: str, c: int) -> dict:
    return {
        "arm": arm,
        "concurrency": c,
        "status": "failed",
        "reqPerSec": None,
        "outTokPerSec": None,
        "ttftMs": None,
        "e2elMs": None,
        "audioTtfpMs": None,
        "audioRtf": None,
    }


async def _run(
    params: dict, base_url: str, model: str, api_key: str
) -> tuple[list[dict], list[str]]:
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    arms = ["audio"] + (["text"] if params.get("voiceTax") else [])
    plan = [(arm, c) for arm in arms for c in params["concurrencyLevels"]]
    timeout = int(params["perPointTimeoutSeconds"])

    points: list[dict] = []
    warnings: list[str] = []
    async with _make_client(timeout) as client:
        for i, (arm, c) in enumerate(plan, start=1):
            log.info("point start arm=%s c=%d (%d/%d)", arm, c, i, len(plan))
            timed_out = False
            try:
                agg = await asyncio.wait_for(
                    run_point(client, base_url, headers, model, arm, c, params),
                    timeout=timeout,
                )
            except TimeoutError:
                agg = None
                timed_out = True
                warnings.append(f"arm={arm} c={c}: point timed out after {timeout}s, skipped")
            if agg is None:
                if not timed_out:
                    reason = "all requests failed"
                    if arm == "audio":
                        reason += " (no decodable audio; endpoint may not return audio)"
                    warnings.append(f"arm={arm} c={c}: {reason}, point skipped")
                points.append(_failed_point(arm, c))
            else:
                points.append({"arm": arm, "concurrency": c, "status": "ok", **agg})
            # 进度行 —— adapter parseProgress 契约格式,勿改。
            log.info("point arm=%s c=%d done (%d/%d)", arm, c, i, len(plan))
    return points, warnings


def main() -> int:
    params = json.loads(os.environ["MD_OMNI_PARAMS"])
    base_url = os.environ["MD_OMNI_BASE_URL"]
    model = os.environ["MD_OMNI_MODEL"]
    api_key = os.environ.get("OPENAI_API_KEY", "")

    points, warnings = asyncio.run(_run(params, base_url, model, api_key))

    result = {"curve": points, "derived": compute_derived(points), "warnings": warnings}
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    RESULT_FILE.write_text(json.dumps(result, indent=2))

    ok = sum(1 for p in points if p["status"] == "ok")
    log.info("done: %d/%d points ok, %d warnings", ok, len(points), len(warnings))
    return 0 if ok > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
