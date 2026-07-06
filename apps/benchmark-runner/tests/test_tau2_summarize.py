"""Tests for tau2/summarize_lib.py — the pure attribution/aggregation logic.

Deliberately tau2-free: benchmark-runner is Python 3.11 but tau2-bench requires
>=3.12, so it cannot be imported (or installed) under this project's dev env.
These tests build lightweight `types.SimpleNamespace` fakes that mimic the
shape of tau2's `SimulationRun`/`RewardInfo` pydantic models instead of
importing tau2 itself. `summarize_lib` only imports tau2 lazily inside
`domain_metrics`/`build_summary`, which this file does not exercise.
"""

from types import SimpleNamespace as NS

from tau2.summarize_lib import (
    aggregate_overall,
    attribution_and_highlights,
    bucket_failure,
)


def _sim(tr="user_stop", reward=0.0, action_checks=None, db_match=None, communicate=None, sid="s"):
    ri = NS(
        reward=reward,
        action_checks=action_checks,
        db_check=(NS(db_match=db_match) if db_match is not None else None),
        communicate_checks=communicate,
    )
    return NS(id=sid, termination_reason=tr, reward_info=ri)


def test_agent_crash():
    assert bucket_failure(_sim(tr="agent_error")) == "agent_crash"


def test_agent_crash_all_variants():
    for tr in ("agent_error", "too_many_errors", "context_window_exceeded", "unexpected_error"):
        assert bucket_failure(_sim(tr=tr)) == "agent_crash"


def test_no_completion():
    assert bucket_failure(_sim(tr="max_steps")) == "no_completion"
    assert bucket_failure(_sim(tr="timeout")) == "no_completion"


def test_wrong_action():
    assert bucket_failure(_sim(action_checks=[NS(action_match=False)])) == "wrong_action"


def test_wrong_final_state():
    assert bucket_failure(_sim(db_match=False)) == "wrong_final_state"


def test_missing_info():
    assert bucket_failure(_sim(communicate=[NS(met=False)])) == "missing_info"


def test_other():
    assert bucket_failure(_sim(tr="user_stop")) == "other"


def test_bucket_priority_crash_beats_wrong_action():
    # agent_crash termination reasons win over other signals even if present.
    sim = _sim(tr="agent_error", action_checks=[NS(action_match=False)])
    assert bucket_failure(sim) == "agent_crash"


def test_aggregate_weighted():
    got = aggregate_overall(
        {
            "a": {"pass1": 0.4, "passK": 0.3, "tasks": 20},
            "b": {"pass1": 0.1, "passK": 0.1, "tasks": 20},
        }
    )
    assert abs(got["pass1"] - 0.25) < 1e-9
    assert abs(got["passK"] - 0.2) < 1e-9
    assert got["tasks"] == 40


def test_aggregate_empty():
    got = aggregate_overall({})
    assert got == {"pass1": 0.0, "passK": 0.0, "tasks": 0}


def test_attribution_fractions_and_highlights():
    sims = {
        "airline": [
            _sim(reward=1.0, sid="ok"),
            _sim(tr="max_steps", reward=0.0, sid="bad"),
            _sim(tr="infrastructure_error", reward=0.0, sid="infra"),
        ]
    }
    attr, hi = attribution_and_highlights(sims)
    assert attr == {"no_completion": 1.0}  # infra excluded, 1 real failure
    assert hi["successSimId"] == "ok"
    assert hi["successDomain"] == "airline"
    assert hi["failureSimId"] == "bad"
    assert hi["failureDomain"] == "airline"


def test_attribution_multiple_domains_and_buckets():
    sims = {
        "airline": [
            _sim(reward=1.0, sid="ok1"),
            _sim(tr="agent_error", reward=0.0, sid="crash1"),
        ],
        "retail": [
            _sim(db_match=False, reward=0.2, sid="wfs1"),
        ],
    }
    attr, hi = attribution_and_highlights(sims)
    assert attr == {"agent_crash": 0.5, "wrong_final_state": 0.5}
    assert hi["successSimId"] == "ok1"
    assert hi["successDomain"] == "airline"
    # lowest reward among failures wins "worst"
    assert hi["failureSimId"] == "crash1"
    assert hi["failureDomain"] == "airline"


def test_attribution_no_failures():
    sims = {"airline": [_sim(reward=1.0, sid="ok")]}
    attr, hi = attribution_and_highlights(sims)
    assert attr == {}
    assert hi["failureSimId"] is None
    assert hi["failureDomain"] is None
