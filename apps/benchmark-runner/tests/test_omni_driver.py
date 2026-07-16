import json
from pathlib import Path

import pytest

from runner.tools import omni_driver

FIXTURE = (Path(__file__).parent / "fixtures" / "omni_bench_stdout.txt").read_text()


# ── stdout 解析 ────────────────────────────────────────────────────────
def test_parse_point_audio_arm():
    p = omni_driver.parse_point(FIXTURE, arm="audio")
    assert p["reqPerSec"] == 0.11
    assert p["outTokPerSec"] == 34.09
    assert p["ttftMs"] == {"mean": 66.3, "p50": 61.0, "p99": 120.5}
    assert p["e2elMs"] == {"mean": 8501.2, "p50": 8400.0, "p99": 9100.0}
    assert p["audioTtfpMs"] == {"mean": 511.0, "p50": 490.0, "p99": 900.0}
    assert p["audioRtf"] == {"mean": 0.19, "p50": 0.18, "p99": 0.3}


def test_parse_point_text_arm_has_null_audio():
    text_out = "\n".join(
        line for line in FIXTURE.splitlines() if "AUDIO" not in line
    )
    p = omni_driver.parse_point(text_out, arm="text")
    assert p["audioTtfpMs"] is None and p["audioRtf"] is None
    assert p["reqPerSec"] == 0.11


def test_parse_point_missing_required_metric_returns_none():
    assert omni_driver.parse_point("garbage output", arm="audio") is None
    # audio 臂缺 AUDIO_RTF(端点没回音频)→ 判失败点
    no_rtf = "\n".join(line for line in FIXTURE.splitlines() if "AUDIO_RTF" not in line)
    assert omni_driver.parse_point(no_rtf, arm="audio") is None


# ── bench argv ────────────────────────────────────────────────────────
def test_bench_argv_audio_arm_locks_methodology():
    argv = omni_driver.bench_argv(
        base_url="http://h:30888", model="m", tokenizer="/tokenizers/Qwen/Qwen2.5-Omni-7B",
        arm="audio", concurrency=8,
        params={"inputTokens": 500, "outputTokens": 300, "numWarmups": 1},
    )
    joined = " ".join(argv)
    assert argv[:4] == ["vllm-omni", "bench", "serve", "--omni"]
    assert "--num-prompts 16" in joined          # max(4, 2×8)
    assert "--max-concurrency 8" in joined
    assert "--ignore-eos" in joined
    assert '"modalities": ["text", "audio"]' in joined
    assert "audio_ttfp" in joined                 # percentile-metrics 带 audio
    assert "--api-key" not in joined              # 秘密只走 env


def test_bench_argv_text_arm_no_audio_metrics():
    argv = omni_driver.bench_argv(
        base_url="http://h:30888", model="m", tokenizer="/t",
        arm="text", concurrency=1,
        params={"inputTokens": 500, "outputTokens": 300, "numWarmups": 1},
    )
    joined = " ".join(argv)
    assert '"modalities": ["text"]' in joined
    assert "audio_ttfp" not in joined
    assert "--num-prompts 4" in joined            # max(4, 2×1)


# ── 派生指标 ──────────────────────────────────────────────────────────
def _pt(arm, c, status="ok", rtf_mean=0.5, e2el_mean=9000.0):
    ok = status == "ok"
    e2el = {"mean": e2el_mean, "p50": e2el_mean, "p99": e2el_mean * 1.2} if ok else None
    audio_ttfp = {"mean": 511.0, "p50": 490.0, "p99": 900.0} if arm == "audio" and ok else None
    audio_rtf = (
        {"mean": rtf_mean, "p50": rtf_mean, "p99": rtf_mean * 1.5}
        if arm == "audio" and ok
        else None
    )
    return {
        "arm": arm, "concurrency": c, "status": status,
        "reqPerSec": 0.5 if ok else None,
        "outTokPerSec": 100.0 if ok else None,
        "ttftMs": {"mean": 66.0, "p50": 60.0, "p99": 120.0} if ok else None,
        "e2elMs": e2el,
        "audioTtfpMs": audio_ttfp,
        "audioRtf": audio_rtf,
    }


def test_compute_derived_ceiling_and_voice_tax():
    points = [
        _pt("audio", 1, rtf_mean=0.19, e2el_mean=8000),
        _pt("audio", 32, rtf_mean=0.54, e2el_mean=9800),
        _pt("audio", 64, rtf_mean=1.24, e2el_mean=15000),
        _pt("text", 1, e2el_mean=5000),
        _pt("text", 32, e2el_mean=5000),
    ]
    d = omni_driver.compute_derived(points)
    assert d["realtimeCeiling"] == 32           # 64 档 RTF≥1 不算
    assert d["peakConcurrency"] == 32
    assert d["voiceTaxMsByLevel"] == {"1": 3000.0, "32": 4800.0}
    assert d["voiceTaxMs"] == 4800.0            # 最高共档


def test_compute_derived_all_over_realtime_gives_zero_ceiling():
    d = omni_driver.compute_derived([_pt("audio", 8, rtf_mean=1.3)])
    assert d["realtimeCeiling"] == 0
    assert d["voiceTaxMs"] is None


# ── 主循环容错(subprocess 注入)────────────────────────────────────
def _env(monkeypatch, tmp_path, voice_tax=True, levels=(1, 8)):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("MD_OMNI_PARAMS", json.dumps({
        "concurrencyLevels": list(levels), "inputTokens": 500, "outputTokens": 300,
        "voiceTax": voice_tax, "numWarmups": 1, "perPointTimeoutSeconds": 60,
    }))
    monkeypatch.setenv("MD_OMNI_BASE_URL", "http://h:30888")
    monkeypatch.setenv("MD_OMNI_MODEL", "m")
    monkeypatch.setenv("MD_OMNI_TOKENIZER_HF_ID", "Qwen/Qwen2.5-Omni-7B")


def test_main_continues_after_single_point_failure(monkeypatch, tmp_path):
    _env(monkeypatch, tmp_path, voice_tax=False, levels=(1, 8))
    monkeypatch.setattr(omni_driver, "resolve_tokenizer", lambda hf_id: "/t")
    calls = []

    def fake_run_bench(argv, timeout):
        calls.append(argv)
        if "--max-concurrency 8" in " ".join(argv):
            return (1, "boom")                   # c=8 失败
        return (0, FIXTURE)

    monkeypatch.setattr(omni_driver, "run_bench", fake_run_bench)
    rc = omni_driver.main()
    assert rc == 0                               # 有 ok 点 → 整体成功
    result = json.loads((tmp_path / "out" / "omni_result.json").read_text())
    assert len(result["curve"]) == 2
    statuses = {p["concurrency"]: p["status"] for p in result["curve"]}
    assert statuses == {1: "ok", 8: "failed"}
    assert any("c=8" in w for w in result["warnings"])


def test_main_all_points_failed_exits_nonzero(monkeypatch, tmp_path):
    _env(monkeypatch, tmp_path, voice_tax=False, levels=(1,))
    monkeypatch.setattr(omni_driver, "resolve_tokenizer", lambda hf_id: "/t")
    monkeypatch.setattr(omni_driver, "run_bench", lambda argv, timeout: (1, "boom"))
    rc = omni_driver.main()
    assert rc == 1
    # result.json 仍要写出(带全 failed 曲线),供事后排障
    assert (tmp_path / "out" / "omni_result.json").exists()


def test_main_runs_both_arms_when_voice_tax(monkeypatch, tmp_path):
    _env(monkeypatch, tmp_path, voice_tax=True, levels=(1,))
    monkeypatch.setattr(omni_driver, "resolve_tokenizer", lambda hf_id: "/t")
    seen_modalities = []

    def fake_run_bench(argv, timeout):
        seen_modalities.append(next(a for a in argv if "modalities" in a))
        return (0, FIXTURE)

    monkeypatch.setattr(omni_driver, "run_bench", fake_run_bench)
    assert omni_driver.main() == 0
    assert len(seen_modalities) == 2             # audio 臂 + text 臂


# ── tokenizer 解析 ────────────────────────────────────────────────────
def test_resolve_tokenizer_prefers_baked_dir(monkeypatch, tmp_path):
    baked = tmp_path / "tokenizers" / "Qwen" / "Qwen2.5-Omni-7B"
    baked.mkdir(parents=True)
    monkeypatch.setattr(omni_driver, "TOKENIZERS_ROOT", tmp_path / "tokenizers")
    assert omni_driver.resolve_tokenizer("Qwen/Qwen2.5-Omni-7B") == str(baked)


def test_resolve_tokenizer_falls_back_to_hf_endpoint(monkeypatch, tmp_path):
    monkeypatch.setattr(omni_driver, "TOKENIZERS_ROOT", tmp_path / "nope")
    monkeypatch.setenv("HF_ENDPOINT", "https://hf-mirror.internal")
    assert omni_driver.resolve_tokenizer("Qwen/X") == "Qwen/X"


def test_resolve_tokenizer_fails_fast_with_guidance(monkeypatch, tmp_path):
    monkeypatch.setattr(omni_driver, "TOKENIZERS_ROOT", tmp_path / "nope")
    monkeypatch.delenv("HF_ENDPOINT", raising=False)
    with pytest.raises(SystemExit, match="tokenizer"):
        omni_driver.resolve_tokenizer("Qwen/X")
    with pytest.raises(SystemExit, match="tokenizerHfId"):
        omni_driver.resolve_tokenizer(None)
