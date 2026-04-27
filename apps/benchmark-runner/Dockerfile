# syntax=docker/dockerfile:1.6

# gpustack/benchmark-runner is GPUStack's official extension of guidellm —
# same CLI surface (--target/--rate-type/--max-requests/--output-path/...)
# plus an --progress-url callback hook. By using it as base we inherit a
# vetted guidellm install (CPU-only torch, ~2.5 GB) instead of pulling the
# full ML stack ourselves. Pin to v0.0.3 — bumping is a deliberate PR with
# new fixture-based metrics-mapper tests.
FROM gpustack/benchmark-runner:v0.0.3

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Copy the project source. Tests are excluded by .dockerignore.
COPY runner runner

# Run as a non-root user. The home dir doesn't have to exist for python -m.
RUN useradd --create-home --shell /sbin/nologin runner
USER runner

# Override the base image's `benchmark-runner benchmark run` entrypoint —
# our orchestrator wraps that subprocess and adds the env-var contract +
# state/metrics callbacks defined by @modeldoctor/contracts.
ENTRYPOINT ["python", "-m", "runner"]
