import asyncio
import base64
import io
import json
import wave

import pytest

from runner.tools import omni_driver


# ── WAV 时长解码 ───────────────────────────────────────────────────────
def _make_wav_b64(duration_sec: float, rate: int = 24000) -> str:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * int(duration_sec * rate))
    return base64.b64encode(buf.getvalue()).decode()


def test_wav_duration_decodes():
    assert abs(omni_driver._wav_duration_seconds(_make_wav_b64(0.5)) - 0.5) < 0.01


def test_wav_duration_bad_input_returns_zero():
    assert omni_driver._wav_duration_seconds("not-base64-wav") == 0.0


# ── percentile / aggregate ─────────────────────────────────────────────
def test_pct_shape():
    p = omni_driver._pct([100.0, 200.0, 300.0])
    assert p["mean"] == 200.0
    assert p["p50"] == 200.0
    assert p["p99"] == pytest.approx(298.0, abs=1.0)


def test_pct_empty_is_none():
    assert omni_driver._pct([]) is None


def test_aggregate_point_audio_arm():
    reqs = [
        {
            "ttftMs": 60.0,
            "e2elMs": 8000.0,
            "audioTtfpMs": 500.0,
            "audioRtfSec": 0.19,
            "completionTokens": 32,
        },
        {
            "ttftMs": 70.0,
            "e2elMs": 9000.0,
            "audioTtfpMs": 520.0,
            "audioRtfSec": 0.21,
            "completionTokens": 32,
        },
    ]
    agg = omni_driver.aggregate_point(reqs, arm="audio", batch_wall=4.0)
    assert agg["reqPerSec"] == 0.5  # 2 / 4s
    assert agg["outTokPerSec"] == 16.0  # 64 tok / 4s
    assert agg["ttftMs"]["mean"] == 65.0
    assert agg["audioTtfpMs"]["mean"] == 510.0
    assert agg["audioRtf"]["mean"] == 0.2


def test_aggregate_point_text_arm_has_null_audio():
    reqs = [
        {
            "ttftMs": 60.0,
            "e2elMs": 400.0,
            "audioTtfpMs": None,
            "audioRtfSec": None,
            "completionTokens": 32,
        }
    ]
    agg = omni_driver.aggregate_point(reqs, arm="text", batch_wall=1.0)
    assert agg["audioTtfpMs"] is None and agg["audioRtf"] is None
    assert agg["ttftMs"]["mean"] == 60.0


# ── build_body / build_prompt ──────────────────────────────────────────
def test_build_body_audio_arm():
    body = omni_driver.build_body("m", "audio", {"inputTokens": 64, "outputTokens": 32})
    assert body["modalities"] == ["text", "audio"]
    assert body["max_tokens"] == 32
    assert body["stream"] is True
    assert body["ignore_eos"] is True
    assert body["stream_options"] == {"include_usage": True}


def test_build_body_text_arm():
    body = omni_driver.build_body("m", "text", {"inputTokens": 64, "outputTokens": 32})
    assert body["modalities"] == ["text"]


def test_build_prompt_pads_to_input_tokens():
    assert len(omni_driver.build_prompt(500)) >= 500
    short = omni_driver.build_prompt(1)
    assert short == omni_driver._BASE_PROMPT


# ── SSE 解析(one_request 用假 stream 客户端)──────────────────────────
class _FakeStream:
    def __init__(self, status, lines):
        self.status_code = status
        self._lines = lines

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def aread(self):
        return b""

    async def aiter_lines(self):
        for ln in self._lines:
            yield ln


class _FakeClient:
    def __init__(self, status, lines):
        self._status = status
        self._lines = lines

    def stream(self, *a, **k):
        return _FakeStream(self._status, self._lines)


def _sse(obj: dict) -> str:
    return "data: " + json.dumps(obj)


def _run_one(status, lines, arm):
    client = _FakeClient(status, lines)
    return asyncio.run(omni_driver.one_request(client, "http://h", {}, {}, arm))


def test_one_request_audio_ok():
    lines = [
        _sse({"modality": "text", "choices": [{"delta": {"content": "读"}}]}),
        _sse({"modality": "audio", "choices": [{"delta": {"content": _make_wav_b64(1.0)}}]}),
        _sse({"choices": [], "usage": {"completion_tokens": 32}}),
        "data: [DONE]",
    ]
    r = _run_one(200, lines, "audio")
    assert r is not None
    assert r["ttftMs"] > 0
    assert r["audioTtfpMs"] is not None
    assert r["audioRtfSec"] is not None and r["audioRtfSec"] > 0
    assert r["completionTokens"] == 32


def test_one_request_text_arm_no_audio_fields():
    lines = [
        _sse({"modality": "text", "choices": [{"delta": {"content": "hi"}}]}),
        "data: [DONE]",
    ]
    r = _run_one(200, lines, "text")
    assert r["audioTtfpMs"] is None and r["audioRtfSec"] is None


def test_one_request_http_error_returns_none():
    assert _run_one(403, [], "audio") is None


def test_one_request_audio_arm_but_no_audio_returns_none():
    lines = [_sse({"modality": "text", "choices": [{"delta": {"content": "hi"}}]}), "data: [DONE]"]
    assert _run_one(200, lines, "audio") is None


# ── run_point 并发 + 容错(mock one_request)──────────────────────────
def _ok_req(arm):
    return {
        "ttftMs": 66.0,
        "e2elMs": 8000.0 if arm == "audio" else 400.0,
        "audioTtfpMs": 500.0 if arm == "audio" else None,
        "audioRtfSec": 0.2 if arm == "audio" else None,
        "completionTokens": 32,
    }


def test_run_point_aggregates_ok(monkeypatch):
    async def fake_one(client, base, headers, body, arm):
        return _ok_req(arm)

    monkeypatch.setattr(omni_driver, "one_request", fake_one)
    agg = asyncio.run(omni_driver.run_point(None, "http://h", {}, "m", "audio", 1, _params()))
    assert agg is not None
    assert agg["audioRtf"]["mean"] == 0.2


def test_run_point_all_failed_returns_none(monkeypatch):
    async def fake_one(*a):
        return None

    monkeypatch.setattr(omni_driver, "one_request", fake_one)
    assert (
        asyncio.run(omni_driver.run_point(None, "http://h", {}, "m", "audio", 1, _params())) is None
    )


# ── 派生指标 ──────────────────────────────────────────────────────────
def _pt(arm, c, status="ok", rtf_mean=0.5, e2el_mean=9000.0):
    audio = {"mean": rtf_mean, "p50": rtf_mean, "p99": rtf_mean * 1.5}
    e2el = {"mean": e2el_mean, "p50": e2el_mean, "p99": e2el_mean * 1.2}
    return {
        "arm": arm,
        "concurrency": c,
        "status": status,
        "reqPerSec": 0.5 if status == "ok" else None,
        "outTokPerSec": 100.0 if status == "ok" else None,
        "ttftMs": {"mean": 66.0, "p50": 60.0, "p99": 120.0} if status == "ok" else None,
        "e2elMs": e2el if status == "ok" else None,
        "audioTtfpMs": ({"mean": 500.0, "p50": 490.0, "p99": 900.0} if arm == "audio" else None)
        if status == "ok"
        else None,
        "audioRtf": (audio if arm == "audio" else None) if status == "ok" else None,
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
    assert d["realtimeCeiling"] == 32
    assert d["peakConcurrency"] == 32
    assert d["voiceTaxMsByLevel"] == {"1": 3000.0, "32": 4800.0}
    assert d["voiceTaxMs"] == 4800.0


def test_compute_derived_all_over_realtime_gives_zero_ceiling():
    d = omni_driver.compute_derived([_pt("audio", 8, rtf_mean=1.3)])
    assert d["realtimeCeiling"] == 0
    assert d["voiceTaxMs"] is None


# ── main 主循环(mock run_point via _run)容错 ────────────────────────
def _params(voice_tax=True, levels=(1,)):
    return {
        "concurrencyLevels": list(levels),
        "inputTokens": 64,
        "outputTokens": 32,
        "voiceTax": voice_tax,
        "numWarmups": 0,
        "perPointTimeoutSeconds": 60,
    }


def _env(monkeypatch, tmp_path, voice_tax=True, levels=(1,)):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("MD_OMNI_PARAMS", json.dumps(_params(voice_tax, levels)))
    monkeypatch.setenv("MD_OMNI_BASE_URL", "http://h:30888")
    monkeypatch.setenv("MD_OMNI_MODEL", "m")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-x")


def test_main_writes_result_and_continues_on_failure(monkeypatch, tmp_path):
    _env(monkeypatch, tmp_path, voice_tax=False, levels=(1, 8))

    async def fake_run_point(client, base, headers, model, arm, c, params):
        if c == 8:
            return None  # c=8 失败
        return omni_driver.aggregate_point([_ok_req(arm)], arm, 1.0)

    monkeypatch.setattr(omni_driver, "run_point", fake_run_point)
    # 避免真装 httpx:替换 client 工厂为哑上下文管理器
    monkeypatch.setattr(omni_driver, "_make_client", lambda t: _NullClient())
    rc = omni_driver.main()
    assert rc == 0
    result = json.loads((tmp_path / "out" / "omni_result.json").read_text())
    statuses = {p["concurrency"]: p["status"] for p in result["curve"]}
    assert statuses == {1: "ok", 8: "failed"}
    assert any("c=8" in w for w in result["warnings"])


def test_main_both_arms_failed_each_get_a_warning(monkeypatch, tmp_path):
    # audio c=1 与 text c=1 都失败 → 两条独立 warning(不因共享 "c=1" 被去重吞掉)。
    _env(monkeypatch, tmp_path, voice_tax=True, levels=(1,))

    async def fake_run_point(*a):
        return None

    monkeypatch.setattr(omni_driver, "run_point", fake_run_point)
    monkeypatch.setattr(omni_driver, "_make_client", lambda t: _NullClient())
    assert omni_driver.main() == 1
    result = json.loads((tmp_path / "out" / "omni_result.json").read_text())
    assert len(result["warnings"]) == 2
    assert any("arm=audio c=1" in w for w in result["warnings"])
    assert any("arm=text c=1" in w for w in result["warnings"])


def test_main_all_failed_exits_nonzero(monkeypatch, tmp_path):
    _env(monkeypatch, tmp_path, voice_tax=False, levels=(1,))

    async def fake_run_point(*a):
        return None

    monkeypatch.setattr(omni_driver, "run_point", fake_run_point)
    monkeypatch.setattr(omni_driver, "_make_client", lambda t: _NullClient())
    rc = omni_driver.main()
    assert rc == 1
    assert (tmp_path / "out" / "omni_result.json").exists()


def test_main_runs_both_arms_when_voice_tax(monkeypatch, tmp_path):
    _env(monkeypatch, tmp_path, voice_tax=True, levels=(1,))
    seen_arms = []

    async def fake_run_point(client, base, headers, model, arm, c, params):
        seen_arms.append(arm)
        return omni_driver.aggregate_point([_ok_req(arm)], arm, 1.0)

    monkeypatch.setattr(omni_driver, "run_point", fake_run_point)
    monkeypatch.setattr(omni_driver, "_make_client", lambda t: _NullClient())
    assert omni_driver.main() == 0
    assert set(seen_arms) == {"audio", "text"}


class _NullClient:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False
