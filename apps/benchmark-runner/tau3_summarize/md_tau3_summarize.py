"""CLI entrypoint: turn tau2 `results.json` files into ModelDoctor's `summary.json`.

Runs inside the Docker image built for Task 8 (Python >=3.12, tau2 installed).
The `tau2` import is deliberately deferred to `main()` so that this module
stays importable (syntax/lint-checkable) under the benchmark-runner package's
own Python 3.11 floor, where `tau2` is neither installed nor installable.
"""

import argparse
import json
import sys
from pathlib import Path

from summarize_lib import build_summary, load_domains


def main() -> int:
    # Lazy import: tau2-bench requires Python >=3.12, only available in the
    # Docker image this CLI runs in (see summarize_lib.py module docstring).
    from tau2.data_model.simulation import Results

    ap = argparse.ArgumentParser()
    ap.add_argument("--run-id", required=True)
    ap.add_argument("--domains", required=True)  # comma-separated
    ap.add_argument("--num-trials", type=int, required=True)
    ap.add_argument("--user-sim-model", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    domains = [d.strip() for d in args.domains.split(",")]

    def _load(d: str):
        path = Path(f"data/simulations/{args.run_id}_{d}/results.json")
        if not path.exists():
            # A domain that crashed before writing results.json (e.g. tau2
            # itself errored out mid-run) must not fail the ENTIRE
            # multi-domain summarize — skip it, not the whole run.
            raise FileNotFoundError(f"no results.json for domain {d!r}: {path}")
        return Results.load(path)

    per_domain, skipped = load_domains(domains, _load)
    if not per_domain:
        print(
            f"ERROR: none of the {len(domains)} domain(s) produced a results.json "
            "— nothing to report",
            file=sys.stderr,
        )
        return 1

    summary = build_summary(
        per_domain, args.num_trials, args.user_sim_model, skipped_domains=skipped
    )
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(summary, indent=2))
    print(f"wrote {args.out}: overall pass^1={summary['overall']['pass1']:.3f}")
    if skipped:
        print(f"WARNING: skipped domain(s) with no results.json: {skipped}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
