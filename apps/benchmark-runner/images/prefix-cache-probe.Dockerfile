# syntax=docker/dockerfile:1.6

# prefix-cache-probe runner image. Validates Higress ai-load-balancer
# stickiness via Prometheus deltas; see
# packages/tool-adapters/src/prefix-cache-probe/runtime.ts and
# apps/benchmark-runner/scripts/prefix_cache_probe.py.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Deps BEFORE COPY so editing runner/ doesn't reinstall them. httpx drives the
# probe; boto3 = the wrapper's declared dep; requests pinned defensively.
RUN pip install --no-cache-dir --disable-pip-version-check \
        'httpx>=0.27,<1' \
        'requests>=2.31,<3' \
        'boto3>=1.34,<2'

WORKDIR /app

COPY runner runner
COPY scripts/prefix_cache_probe.py /app/probe.py

# Non-root user (matches sibling Dockerfiles).
RUN useradd --create-home --shell /sbin/nologin runner \
    && chown -R runner:runner /app
USER runner

# Generic wrapper; argv produced by
# packages/tool-adapters/src/prefix-cache-probe/runtime.ts is
# python /app/probe.py ...
ENTRYPOINT ["python", "-m", "runner"]
