# syntax=docker/dockerfile:1.6
# Base image for the aiperf runner.
# Contains aiperf + baked ShareGPT V3 corpus — NO ModelDoctor runner scripts.
# Rebuild and push only when bumping tool versions; tag matches AIPERF_VERSION.
#
#   ./tools/build-base-images.sh aiperf
#
# Then update aiperf.Dockerfile's FROM line to the new tag.
#
# NOTE: if the HuggingFace curl step fails with a TLS error inside Docker
# Desktop for Mac, run build-base-images.sh with --sharegpt-host-download
# (downloads the 672 MB file on the host first, then COPYs it in).
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

ARG AIPERF_VERSION=0.7.0

RUN pip install --no-cache-dir "aiperf==${AIPERF_VERSION}"

# Bake ShareGPT V3 corpus (~672 MB) so --public-dataset sharegpt works on
# air-gapped clusters. aiperf's ShareGPTLoader resolves
# `.cache/aiperf/datasets/<filename>` relative to WORKDIR (/app).
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && mkdir -p /app/.cache/aiperf/datasets \
    && curl -fL --retry 3 --retry-delay 5 \
        --output /app/.cache/aiperf/datasets/ShareGPT_V3_unfiltered_cleaned_split.json \
        https://huggingface.co/datasets/anon8231489123/ShareGPT_Vicuna_unfiltered/resolve/main/ShareGPT_V3_unfiltered_cleaned_split.json \
    && apt-get purge -y --auto-remove curl \
    && rm -rf /var/lib/apt/lists/*
