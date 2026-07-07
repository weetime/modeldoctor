# syntax=docker/dockerfile:1.6
# tau2-bench runner — Task 8 of the agent-capability-testing-tau2 plan.
#
# Single-stage (unlike aiperf/evalscope/vegeta): there is no pre-existing
# ghcr.io base image for tau2, and its data corpus is small enough (~140 MB
# after trimming, see below) that a base/wrapper split isn't worth the extra
# registry-push step. tau2-bench requires Python >=3.12 (benchmark-runner's
# own wrapper floor is 3.11), so this is the ONLY image in images/ on 3.12.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# System deps:
#  - git: clone tau2-bench (only needed at build).
#  - gcc + python3-dev + portaudio19-dev: τ³ v1.0.0 has an upstream packaging
#    bug — `tau2/__init__.py` and `registry.py` EAGERLY import the voice +
#    knowledge modules at top level even though those deps are declared optional
#    in pyproject. So EVERY `import tau2.*` (incl. our summarizer's
#    `from tau2.data_model...`) fails unless the full voice+knowledge stack is
#    present. voice drags pyaudio, which has no wheel and needs portaudio dev
#    headers + a C compiler to build. We run text-only but must satisfy the
#    eager import chain; libportaudio (pulled by portaudio19-dev) must remain at
#    runtime since pyaudio loads it at import. See task-17b image-fix report.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git gcc python3-dev portaudio19-dev \
    && rm -rf /var/lib/apt/lists/*

# Pin the τ³-bench v1.0.0 release tag for reproducibility.
# Bump deliberately via a PR — tau2's CLI surface feeds packages/tool-adapters/
# src/tau3/build-command.ts directly, so an upstream flag/behavior change must
# be caught by tau2's own runtime tests, not silently picked up on rebuild.
ARG TAU3_REF=v1.0.0

# Clone + install tau2-bench (editable, src-layout: source stays at
# /opt/tau2/src/tau2 — repo root /opt/tau2 has NO top-level `tau2/` dir, so it
# can never shadow the installed package via an implicit CWD sys.path entry).
#
# The upstream repo ships ~800 MB of `data/` (baseline leaderboard result
# dumps under data/tau2/results/, voice/audio assets) that our text-only
# airline/retail/telecom runs never touch — trim them in this layer so they
# never enter an image layer.
#
# tau2.utils.utils.DATA_DIR resolves to TAU2_DATA_DIR if set, else
# `<package source dir>/../../../data` (i.e. /opt/tau2/data for an editable
# install) — verified against the cloned source. We pin it explicitly with
# TAU2_DATA_DIR below anyway so behavior doesn't depend on __file__
# introspection surviving future tau2 refactors.
RUN git clone https://github.com/sierra-research/tau2-bench.git /opt/tau2 \
    && cd /opt/tau2 \
    && git checkout "${TAU3_REF}" \
    && rm -rf .git data/tau2/results data/voice \
    && pip install --no-cache-dir -e '.[voice,knowledge]'

ENV TAU2_DATA_DIR=/opt/tau2/data
RUN tau2 check-data

WORKDIR /app

# Runner wrapper's own runtime deps (boto3 for S3 report upload), installed
# BEFORE `COPY runner` so editing runner/ doesn't bust this layer. Mirrors
# aiperf.Dockerfile / guidellm.Dockerfile.
RUN pip install --no-cache-dir --disable-pip-version-check 'requests>=2.31,<3' 'boto3>=1.34,<2'

COPY runner runner
# The tau3-report summarizer (packages/tool-adapters' buildCommand invokes it
# via `python /app/tau3_summarize/md_tau3_summarize.py`). Its
# `from summarize_lib import build_summary` is a flat import resolved via
# Python's implicit "script's own directory" sys.path[0] entry — no
# PYTHONPATH needed for that half. `from tau2.data_model...` resolves to the
# real pip-installed tau2 above (this dir is deliberately NOT named `tau2/` —
# see Task 7, which renamed it to avoid exactly this shadow).
COPY tau3_summarize /app/tau3_summarize

# `python -m runner.main` must resolve regardless of CWD, so PYTHONPATH
# points at /app where `runner` and `tau3_summarize` live. The process CWD
# is set to /opt/tau2 (NOT /app) — packages/tool-adapters/src/tau3/
# build-command.ts's outputFiles use paths relative to tau2's own data dir
# convention (`data/simulations/<runId>_<domain>/results.json`,
# `md_out/summary.json`); the generic runner (runner/main.py) resolves those
# via `Path.cwd() / rel_path`, so CWD must be /opt/tau2 for
# `data/simulations/...` to land under TAU2_DATA_DIR (/opt/tau2/data), which
# is where tau2's own `batch.py` (`save_dir = DATA_DIR / "simulations" / ...`)
# independently writes results.
ENV PYTHONPATH=/app
WORKDIR /opt/tau2

RUN useradd --create-home --shell /sbin/nologin runner \
    && chown -R runner:runner /app /opt/tau2
USER runner

ENTRYPOINT ["python", "-m", "runner.main"]
