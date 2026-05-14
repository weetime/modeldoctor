# syntax=docker/dockerfile:1.6

# Phase 1 of evalscope rollout. evalscope is the load generator, not the
# model server. Bake LongAlpaca-12k at build time so air-gapped clusters
# can run the official 6-task methodology without runtime network egress.
# Image ~1.7 GB (python:3.11-slim ~130 MB + evalscope+deps ~1.4 GB +
# LongAlpaca dataset ~200 MB).
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MODELSCOPE_CACHE=/opt/evalscope-datasets

ARG EVALSCOPE_VERSION=0.18.0

RUN pip install --no-cache-dir \
        "evalscope==${EVALSCOPE_VERSION}" \
        "modelscope==1.20.1" \
        'requests>=2.31,<3'

# Bake LongAlpaca-12k. modelscope download writes to a sharded local dir.
RUN modelscope download \
        AI-ModelScope/LongAlpaca-12k \
        --local_dir /opt/evalscope-datasets/longalpaca

WORKDIR /app
COPY runner runner

RUN useradd --create-home --shell /sbin/nologin runner \
    && chown -R runner:runner /app /opt/evalscope-datasets
USER runner

ENTRYPOINT ["python", "-m", "runner"]
