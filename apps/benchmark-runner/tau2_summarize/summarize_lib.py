"""Turn tau2 Results into ModelDoctor's summary.json shape.

Reuses tau2's own metrics (compute_metrics / pass^k) for per-domain numbers;
the pure attribution/aggregation logic below is tau2-free so it is unit-testable
without a Python 3.12 tau2 install (tau2 is imported lazily only where needed).

benchmark-runner is pinned to Python >=3.11, while tau2-bench requires >=3.12,
so `tau2` cannot be a dependency of this package (and cannot be imported at
module import time here). The tau2 dependency lives only in the Docker image
that runs this CLI (a 3.12 base, see Task 8).
"""

import sys

# termination_reason compared by string value → works for both tau2's str-Enum
# and plain-string test fakes (no tau2 import needed here).
_CRASH = {"agent_error", "too_many_errors", "context_window_exceeded", "unexpected_error"}
_NO_COMPLETION = {"max_steps", "timeout"}
_INFRA = "infrastructure_error"


def _tr(sim) -> str:
    tr = sim.termination_reason
    return getattr(tr, "value", tr)  # enum -> .value; plain str -> itself


def _is_successful(reward) -> bool:
    return reward is not None and (1 - 1e-6) <= reward <= (1 + 1e-6)


def bucket_failure(sim) -> str:
    """Classify a FAILED sim (reward<1). Priority order matters."""
    tr = _tr(sim)
    if tr in _CRASH:
        return "agent_crash"
    ri = getattr(sim, "reward_info", None)
    action_checks = getattr(ri, "action_checks", None) if ri else None
    if action_checks and any(not ac.action_match for ac in action_checks):
        return "wrong_action"
    if ri and getattr(ri, "db_check", None) and not ri.db_check.db_match:
        return "wrong_final_state"
    communicate_checks = getattr(ri, "communicate_checks", None) if ri else None
    if communicate_checks and any(not c.met for c in communicate_checks):
        return "missing_info"
    if tr in _NO_COMPLETION:
        return "no_completion"
    return "other"


def attribution_and_highlights(per_domain_sims: dict) -> tuple[dict, dict]:
    """per_domain_sims: {domain: [sim, ...]}. Returns (attribution_dict, highlights_dict).

    attribution = failed-bucket fractions over ALL failed sims (infra errors excluded).
    """
    counts: dict = {}
    total_failed = 0
    best = (-1.0, None, None)  # (reward, sim_id, domain) among successes
    worst = (2.0, None, None)  # among failures
    for dname, sims in per_domain_sims.items():
        for sim in sims:
            if _tr(sim) == _INFRA:
                continue
            r = sim.reward_info.reward if getattr(sim, "reward_info", None) else 0.0
            if _is_successful(r):
                if r > best[0]:
                    best = (r, sim.id, dname)
            else:
                total_failed += 1
                b = bucket_failure(sim)
                counts[b] = counts.get(b, 0) + 1
                if r < worst[0]:
                    worst = (r, sim.id, dname)
    attribution = {k: v / total_failed for k, v in counts.items()} if total_failed else {}
    highlights = {
        "successSimId": best[1],
        "successDomain": best[2],
        "failureSimId": worst[1],
        "failureDomain": worst[2],
    }
    return attribution, highlights


def aggregate_overall(domain_metrics_map: dict) -> dict:
    """Task-weighted overall from per-domain metric dicts {domain: {pass1,passK,tasks}}."""
    total_tasks = sum(m["tasks"] for m in domain_metrics_map.values())
    if not total_tasks:
        return {"pass1": 0.0, "passK": 0.0, "tasks": 0}
    p1 = sum(m["pass1"] * m["tasks"] for m in domain_metrics_map.values()) / total_tasks
    pk = sum(m["passK"] * m["tasks"] for m in domain_metrics_map.values()) / total_tasks
    return {"pass1": p1, "passK": pk, "tasks": total_tasks}


def domain_metrics(results) -> dict:
    """Per-domain metrics via tau2's own compute_metrics (lazy import; needs py3.12)."""
    from tau2.metrics.agent_metrics import compute_metrics

    m = compute_metrics(results)
    pass_ks = m.pass_hat_ks or {}
    max_k = max(pass_ks) if pass_ks else 1
    return {
        "pass1": pass_ks.get(1, 0.0),
        "passK": pass_ks.get(max_k, pass_ks.get(1, 0.0)),
        "tasks": m.total_tasks,
        "avgReward": m.avg_reward,
        "infraErrors": m.infra_error_count,
    }


def load_domains(domains: list, loader) -> tuple:
    """Load per-domain results via `loader(domain) -> Results`, skipping (with
    a stderr warning) any domain whose loader raises — e.g. a domain that
    crashed before writing results.json (FileNotFoundError), or one whose
    results.json is truncated/corrupt (any other load failure). One bad
    domain must not take down the whole multi-domain summarize run.

    tau2-free by design: `loader` is injected so this can be unit-tested
    without importing tau2 (see md_tau2_summarize.py for the real,
    tau2-backed loader).

    Returns (per_domain_results, skipped_domains).
    """
    per_domain: dict = {}
    skipped: list = []
    for d in domains:
        try:
            per_domain[d] = loader(d)
        except Exception as e:  # noqa: BLE001 - any single-domain load failure is non-fatal
            print(f"WARNING: skipping domain {d!r} — failed to load results: {e}", file=sys.stderr)
            skipped.append(d)
    return per_domain, skipped


def build_summary(
    per_domain_results: dict,
    num_trials: int,
    user_sim_model: str,
    skipped_domains: list | None = None,
) -> dict:
    """per_domain_results: {domain: tau2 Results}. Orchestrates the tau2 + pure parts.

    `skipped_domains`: domains that crashed / had no results.json and were
    excluded from `per_domain_results` upstream (see `load_domains`) — passed
    through so the summary makes the gap visible instead of silently
    reporting a partial run as if it were complete.
    """
    dmetrics = {d: domain_metrics(r) for d, r in per_domain_results.items()}
    per_domain_sims = {d: list(r.simulations) for d, r in per_domain_results.items()}
    attribution, highlights = attribution_and_highlights(per_domain_sims)
    return {
        "kind": "agent-tau2",
        "userSimModel": user_sim_model,
        "numTrials": num_trials,
        "overall": aggregate_overall(dmetrics),
        "perDomain": dmetrics,
        "attribution": attribution,
        "highlights": highlights,
        "skippedDomains": skipped_domains or [],
    }
