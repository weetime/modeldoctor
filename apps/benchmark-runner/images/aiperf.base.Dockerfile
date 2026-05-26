# syntax=docker/dockerfile:1.6
# Base image for the aiperf runner.
# Contains aiperf + baked ShareGPT V3 corpus — NO ModelDoctor runner scripts.
# Rebuild and push only when bumping tool versions; tag matches AIPERF_VERSION.
#
#   ./tools/build-base-images.sh aiperf
#
# Then update aiperf.Dockerfile's FROM line to the new tag.
#
# build-base-images.sh pre-downloads the ShareGPT corpus on the host to work
# around Docker Desktop for Mac TLS failures (curl error 35) to huggingface.co
# inside the builder. The corpus is then COPYed in rather than fetched here.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

ARG AIPERF_VERSION=0.7.0

RUN pip install --no-cache-dir "aiperf==${AIPERF_VERSION}"

# Bake ShareGPT V3 corpus (~672 MB) so --public-dataset sharegpt works on
# air-gapped clusters. aiperf's ShareGPTLoader resolves
# `.cache/aiperf/datasets/<filename>` relative to WORKDIR (/app).
WORKDIR /app
RUN mkdir -p /app/.cache/aiperf/datasets
COPY images/.sharegpt/ShareGPT_V3_unfiltered_cleaned_split.json \
     /app/.cache/aiperf/datasets/ShareGPT_V3_unfiltered_cleaned_split.json
