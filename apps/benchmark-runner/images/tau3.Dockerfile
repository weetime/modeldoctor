# syntax=docker/dockerfile:1.6
# tau3 (tau2-bench) runner — our thin wrapper on top of the stable base image.
# Rebuild whenever runner/ changes; the base (apt toolchain + tau2-bench +
# baked data) is pulled from the registry cache.
# To bump the base (new tau2 ref or changed baked data): run
# `./tools/build-base-images.sh tau3`, then update the tag below to match
# TAU3_IMAGE_TAG in build-base-images.sh.
FROM ghcr.io/weetime/md-base-tau3:1.0.0

WORKDIR /app

# Runner wrapper's own runtime deps (boto3 for S3 report upload), installed
# BEFORE `COPY runner` so editing runner/ doesn't bust this layer. Mirrors
# aiperf.Dockerfile / evalscope.Dockerfile.
RUN pip install --no-cache-dir --disable-pip-version-check 'requests>=2.31,<3' 'boto3>=1.34,<2'

COPY runner runner
# The tau3-report summarizer (packages/tool-adapters' buildCommand invokes it
# via `python /app/tau3_summarize/md_tau3_summarize.py`). Its
# `from summarize_lib import build_summary` is a flat import resolved via
# Python's implicit "script's own directory" sys.path[0] entry — no
# PYTHONPATH needed for that half. `from tau2.data_model...` resolves to the
# real pip-installed tau2 in the base image (this dir is deliberately NOT named
# `tau2/` — see Task 7, which renamed it to avoid exactly this shadow).
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
