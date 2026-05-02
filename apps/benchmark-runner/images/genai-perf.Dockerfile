# syntax=docker/dockerfile:1.6

# Phase 4 of #53: genai-perf runner image.
#
# Why python:3.11-slim (not nvcr.io/nvidia/tritonserver:<tag>-genai-perf)?
# - genai-perf is the *load generator*, not the model server. It sends HTTP
#   requests to an OpenAI-compatible endpoint; it does not need an NVIDIA GPU
#   or CUDA runtime in this container.
# - The Triton base image is 10-15 GB. python:3.11-slim is ~130 MB, resulting
#   in a final image of ~600 MB–1.5 GB (numpy/pandas transitive deps) — far
#   more practical for K8s Job scheduling.
# - Pin to 0.0.16 — bumping is a deliberate PR (same policy as guidellm v0.0.3
#   and vegeta v12.13.0).
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

ARG GENAI_PERF_VERSION=0.0.16

# Install genai-perf and the wrapper's pinned HTTP dep.
# genai-perf pulls numpy, pandas, tritonclient, etc. — large but expected.
# requests is listed explicitly so its constraint is locked even if genai-perf's
# transitive constraint loosens in a future release (matches pyproject.toml's
# requests>=2.31,<3 declaration).
RUN pip install --no-cache-dir \
        "genai-perf==${GENAI_PERF_VERSION}" \
        'requests>=2.31,<3'

WORKDIR /app

# Copy the wrapper. Tests are excluded by .dockerignore.
COPY runner runner

# Run as a non-root user (matches guidellm.Dockerfile / vegeta.Dockerfile).
RUN useradd --create-home --shell /sbin/nologin runner
USER runner

# Generic wrapper (#53 Phase 3); genai-perf is invoked via /bin/sh -c
# wrapper produced by `packages/tool-adapters/src/genai-perf/runtime.ts`.
ENTRYPOINT ["python", "-m", "runner"]
