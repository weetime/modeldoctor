# syntax=docker/dockerfile:1.6

# kv-cache-stress runner image. Multi-turn dialog stress that measures
# KV cache backend performance (LMCache / YRCache / vanilla vLLM). See
# packages/tool-adapters/src/kv-cache-stress/runtime.ts and
# apps/benchmark-runner/scripts/kv_cache_stress.py for the contract.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Same dependency pins as prefix-cache-probe — both probes only need httpx
# and requests; staying aligned keeps the layer cacheable across images.
RUN pip install --no-cache-dir \
        'httpx>=0.27,<1' \
        'requests>=2.31,<3'

WORKDIR /app

COPY runner runner
COPY scripts/kv_cache_stress.py /app/probe.py

# Non-root user (matches sibling Dockerfiles).
RUN useradd --create-home --shell /sbin/nologin runner \
    && chown -R runner:runner /app
USER runner

# Generic wrapper; argv produced by
# packages/tool-adapters/src/kv-cache-stress/runtime.ts is
# python /app/probe.py ...
ENTRYPOINT ["python", "-m", "runner"]
