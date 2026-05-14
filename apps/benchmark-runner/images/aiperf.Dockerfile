# syntax=docker/dockerfile:1.6

# NVIDIA aiperf (ai-dynamo) perf load generator. Bakes ShareGPT V3
# corpus (~672 MB) at build time so --public-dataset sharegpt works
# on air-gapped clusters. Image ~1.7 GB.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

ARG AIPERF_VERSION=0.7.0

RUN pip install --no-cache-dir \
        "aiperf==${AIPERF_VERSION}" \
        'requests>=2.31,<3'

WORKDIR /app
COPY runner runner

# Bake ShareGPT V3 corpus (~672 MB) so --public-dataset sharegpt
# works on air-gapped clusters. aiperf's ShareGPTLoader resolves
# `.cache/aiperf/datasets/<filename>` relative to WORKDIR (/app);
# pre-populate that exact path. Image goes from ~1 GB to ~1.7 GB.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && mkdir -p /app/.cache/aiperf/datasets \
    && curl -fL --output /app/.cache/aiperf/datasets/ShareGPT_V3_unfiltered_cleaned_split.json \
        https://huggingface.co/datasets/anon8231489123/ShareGPT_Vicuna_unfiltered/resolve/main/ShareGPT_V3_unfiltered_cleaned_split.json \
    && apt-get purge -y --auto-remove curl \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --shell /sbin/nologin runner \
    && chown -R runner:runner /app
USER runner

ENTRYPOINT ["python", "-m", "runner"]
