"""Omni sweep driver: 循环 `vllm-omni bench serve --omni` 扫 双臂 × 并发档,
逐点解析 stdout 汇总,聚合写 out/omni_result.json(形状 = vllmOmniBenchReportSchema)。

由通用 wrapper 以工具 argv 启动: python -m runner.tools.omni_driver
契约(packages/tool-adapters/src/vllm-omni-bench/runtime.ts 写入):
  MD_OMNI_PARAMS            params JSON(concurrencyLevels/inputTokens/outputTokens/
                            voiceTax/numWarmups/perPointTimeoutSeconds)
  MD_OMNI_BASE_URL          上游 base URL(无尾斜杠)
  MD_OMNI_MODEL             served model 名
  MD_OMNI_TOKENIZER_HF_ID   可选 HF tokenizer repo id
  OPENAI_API_KEY            (secretEnv) vllm bench openai 后端自取作 Bearer
方法学纪律(写死): 双臂同 max_tokens、--ignore-eos、num-prompts = max(4, 2×c)。
"""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import sys
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="[omni-driver] %(message)s")
log = logging.getLogger("omni-driver")

OUT_DIR = Path("out")
RESULT_FILE = OUT_DIR / "omni_result.json"
TOKENIZERS_ROOT = Path("/tokenizers")
# HF repo id shape: "<org>/<name>", each segment word-chars/dot/dash, org
# can't start with those (blocks a leading "." or "-" segment while still
# allowing e.g. "Qwen2.5-Omni-7B" style names). Rejects "../etc", "/abs/path"
# etc. before they're joined onto TOKENIZERS_ROOT (M-3: path traversal).
HF_ID_RE = re.compile(r"^[A-Za-z0-9][\w.-]*/[\w.-]+$")


# 数值行:标签允许 (ms) 等单位尾缀,冒号后取第一个浮点。
def _rx(label: str) -> re.Pattern[str]:
    return re.compile(rf"^{re.escape(label)}[^:]*:\s*([\d.]+)\s*$", re.MULTILINE)


_PATTERNS = {
    "reqPerSec": _rx("Request throughput (req/s)"),
    "outTokPerSec": _rx("Output token throughput (tok/s)"),
    "ttft_mean": _rx("Mean TTFT"),
    "ttft_p50": _rx("Median TTFT"),
    "ttft_p99": _rx("P99 TTFT"),
    "e2el_mean": _rx("Mean E2EL"),
    "e2el_p50": _rx("Median E2EL"),
    "e2el_p99": _rx("P99 E2EL"),
    "audio_ttfp_mean": _rx("Mean AUDIO_TTFP"),
    "audio_ttfp_p50": _rx("Median AUDIO_TTFP"),
    "audio_ttfp_p99": _rx("P99 AUDIO_TTFP"),
    "audio_rtf_mean": _rx("Mean AUDIO_RTF"),
    "audio_rtf_p50": _rx("Median AUDIO_RTF"),
    "audio_rtf_p99": _rx("P99 AUDIO_RTF"),
}


def _grab(stdout: str, key: str) -> float | None:
    m = _PATTERNS[key].search(stdout)
    return float(m.group(1)) if m else None


def _stat(stdout: str, prefix: str) -> dict[str, float] | None:
    mean = _grab(stdout, f"{prefix}_mean")
    p50 = _grab(stdout, f"{prefix}_p50")
    p99 = _grab(stdout, f"{prefix}_p99")
    if mean is None or p50 is None or p99 is None:
        return None
    return {"mean": mean, "p50": p50, "p99": p99}


def parse_point(stdout: str, arm: str) -> dict | None:
    """一档 bench stdout → curve point 数值部分;缺必要指标返回 None(判失败点)。

    必要指标: reqPerSec + ttft + e2el;audio 臂还必须有 audio_ttfp + audio_rtf
    (端点没回音频时 bench 的 AUDIO_* 段缺失 → 判失败,warning 提示查 modalities)。
    """
    req = _grab(stdout, "reqPerSec")
    ttft = _stat(stdout, "ttft")
    e2el = _stat(stdout, "e2el")
    if req is None or ttft is None or e2el is None:
        return None
    audio_ttfp = _stat(stdout, "audio_ttfp")
    audio_rtf = _stat(stdout, "audio_rtf")
    if arm == "audio" and (audio_ttfp is None or audio_rtf is None):
        return None
    return {
        "reqPerSec": req,
        "outTokPerSec": _grab(stdout, "outTokPerSec") or 0.0,
        "ttftMs": ttft,
        "e2elMs": e2el,
        "audioTtfpMs": audio_ttfp if arm == "audio" else None,
        "audioRtf": audio_rtf if arm == "audio" else None,
    }


def bench_argv(
    *, base_url: str, model: str, tokenizer: str, arm: str, concurrency: int, params: dict
) -> list[str]:
    modalities = ["text", "audio"] if arm == "audio" else ["text"]
    pct = "ttft,e2el,audio_ttfp,audio_rtf" if arm == "audio" else "ttft,e2el"
    return [
        "vllm-omni", "bench", "serve", "--omni",
        "--backend", "openai-chat-omni",
        "--base-url", base_url,
        "--endpoint", "/v1/chat/completions",
        "--model", model,
        "--tokenizer", tokenizer,
        "--dataset-name", "random",
        "--random-input-len", str(params["inputTokens"]),
        "--random-output-len", str(params["outputTokens"]),
        "--num-prompts", str(max(4, 2 * concurrency)),
        "--max-concurrency", str(concurrency),
        "--num-warmups", str(params["numWarmups"]),
        "--ignore-eos",
        "--extra-body", json.dumps({"modalities": modalities}),
        "--percentile-metrics", pct,
    ]


def run_bench(argv: list[str], timeout: int) -> tuple[int, str]:
    """跑一档 bench;返回 (returncode, stdout+stderr 合流文本)。

    测试通过 monkeypatch 替换本函数注入假输出。stdout 事后整体打印(tee 到
    pod log),不做流式 —— bench 的 Rich 进度条本就不适合逐行转发。
    """
    try:
        proc = subprocess.run(  # noqa: S603 - argv 内部构造
            argv, capture_output=True, text=True, timeout=timeout
        )
    except subprocess.TimeoutExpired:
        return (124, f"bench timed out after {timeout}s")
    return (proc.returncode, (proc.stdout or "") + "\n" + (proc.stderr or ""))


def resolve_tokenizer(hf_id: str | None) -> str:
    if not hf_id:
        raise SystemExit(
            "tokenizer required: set tokenizerHfId on the Connection "
            "(baked under /tokenizers/<org>/<name>) or provide HF_ENDPOINT"
        )
    if not HF_ID_RE.match(hf_id):
        raise SystemExit(
            f"tokenizerHfId '{hf_id}' is not a valid 'org/name' HF repo id "
            "(rejecting to avoid escaping /tokenizers via '..' or an absolute path)"
        )
    baked = TOKENIZERS_ROOT / hf_id
    if baked.is_dir():
        return str(baked)
    if os.environ.get("HF_ENDPOINT"):
        return hf_id  # bench 自行从内网镜像源拉
    raise SystemExit(
        f"tokenizer '{hf_id}' not baked into the image ({TOKENIZERS_ROOT}) and "
        "HF_ENDPOINT is unset — bake it or point HF_ENDPOINT at an internal mirror"
    )


def compute_derived(points: list[dict]) -> dict:
    audio_ok = [p for p in points if p["arm"] == "audio" and p["status"] == "ok"]
    realtime = [p["concurrency"] for p in audio_ok if p["audioRtf"] and p["audioRtf"]["mean"] < 1.0]
    ceiling = max(realtime) if realtime else 0
    text_by_c = {
        p["concurrency"]: p for p in points if p["arm"] == "text" and p["status"] == "ok"
    }
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


def main() -> int:
    params = json.loads(os.environ["MD_OMNI_PARAMS"])
    base_url = os.environ["MD_OMNI_BASE_URL"]
    model = os.environ["MD_OMNI_MODEL"]
    tokenizer = resolve_tokenizer(os.environ.get("MD_OMNI_TOKENIZER_HF_ID"))

    arms = ["audio"] + (["text"] if params.get("voiceTax") else [])
    plan = [(arm, c) for arm in arms for c in params["concurrencyLevels"]]
    timeout = int(params["perPointTimeoutSeconds"])

    points: list[dict] = []
    warnings: list[str] = []
    for i, (arm, c) in enumerate(plan, start=1):
        argv = bench_argv(
            base_url=base_url, model=model, tokenizer=tokenizer,
            arm=arm, concurrency=c, params=params,
        )
        log.info("bench start arm=%s c=%d (%d/%d)", arm, c, i, len(plan))
        rc, output = run_bench(argv, timeout)
        print(output, flush=True)  # tee 到 pod log,事后可查每档原始汇总
        parsed = parse_point(output, arm) if rc == 0 else None
        if parsed is None:
            reason = f"bench exited {rc}" if rc != 0 else "summary metrics missing from output"
            if rc == 0 and arm == "audio":
                reason += " (no AUDIO_* section — endpoint may not return audio; check modalities)"
            warnings.append(f"arm={arm} c={c}: {reason}, point skipped")
            points.append({
                "arm": arm, "concurrency": c, "status": "failed",
                "reqPerSec": None, "outTokPerSec": None,
                "ttftMs": None, "e2elMs": None, "audioTtfpMs": None, "audioRtf": None,
            })
        else:
            points.append({"arm": arm, "concurrency": c, "status": "ok", **parsed})
        # 进度行 —— adapter parseProgress 的契约格式,勿改。
        log.info("point arm=%s c=%d done (%d/%d)", arm, c, i, len(plan))

    result = {"curve": points, "derived": compute_derived(points), "warnings": warnings}
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    RESULT_FILE.write_text(json.dumps(result, indent=2))

    ok = sum(1 for p in points if p["status"] == "ok")
    log.info("done: %d/%d points ok, %d warnings", ok, len(points), len(warnings))
    return 0 if ok > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
