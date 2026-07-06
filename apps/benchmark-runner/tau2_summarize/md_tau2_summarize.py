"""CLI entrypoint: turn tau2 `results.json` files into ModelDoctor's `summary.json`.

Runs inside the Docker image built for Task 8 (Python >=3.12, tau2 installed).
The `tau2` import is deliberately deferred to `main()` so that this module
stays importable (syntax/lint-checkable) under the benchmark-runner package's
own Python 3.11 floor, where `tau2` is neither installed nor installable.
"""

import argparse
import json
from pathlib import Path

from summarize_lib import build_summary


def main() -> None:
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

    per_domain = {}
    for d in [d.strip() for d in args.domains.split(",")]:
        path = Path(f"data/simulations/{args.run_id}_{d}/results.json")
        per_domain[d] = Results.load(path)

    summary = build_summary(per_domain, args.num_trials, args.user_sim_model)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(summary, indent=2))
    print(f"wrote {args.out}: overall pass^1={summary['overall']['pass1']:.3f}")


if __name__ == "__main__":
    main()
