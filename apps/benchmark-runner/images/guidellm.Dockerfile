# syntax=docker/dockerfile:1.6

# Phase 3 of #53: per-tool image. gpustack/benchmark-runner is GPUStack's
# official extension of guidellm with the same CLI surface plus an
# --progress-url callback hook. Using it as base inherits a vetted
# guidellm install (CPU-only torch, ~2.5 GB) instead of pulling the full
# ML stack ourselves. Pin to v0.0.3 — bumping is a deliberate PR with
# new fixture-based runtime tests.
FROM gpustack/benchmark-runner:v0.0.3

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Runner deps BEFORE `COPY runner` so editing runner/ doesn't bust this layer
# and reinstall on every image rebuild. boto3 = the wrapper's only declared dep
# (pyproject.toml); requests is pinned defensively — don't drop the constraint
# or pip will silently grab requests 3.x when it ships.
RUN pip install --no-cache-dir --disable-pip-version-check 'requests>=2.31,<3' 'boto3>=1.34,<2'

# Copy the wrapper. Tests are excluded by .dockerignore.
COPY runner runner

# Run as a non-root user.
RUN useradd --create-home --shell /sbin/nologin runner \
    && chown -R runner:runner /app
USER runner

# Generic wrapper (#53 Phase 3); guidellm is invoked as a subprocess via
# MD_ARGV produced by `packages/tool-adapters/src/guidellm/runtime.ts`.
ENTRYPOINT ["python", "-m", "runner"]
