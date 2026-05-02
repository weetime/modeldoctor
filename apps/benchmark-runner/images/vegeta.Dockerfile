# syntax=docker/dockerfile:1.6

# Phase 3 of #53: vegeta runner image. Layers our Python wrapper on top
# of a pinned vegeta CLI binary. Unlike guidellm (Python), vegeta is a
# single Go static binary, so the image is small (~50 MB Python slim +
# ~10 MB vegeta) and contains no ML dependencies.
#
# peterevans/vegeta is stale (last published 2020, vegeta 12.8.4). We
# download the canonical binary directly from tsenart/vegeta releases.
# Pin to v12.13.0 — bumping is a deliberate PR.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Download the vegeta static binary for the target platform.
# The binary is a single statically-linked executable; no extra deps needed.
ARG VEGETA_VERSION=12.13.0
RUN set -eux; \
    ARCH="$(dpkg --print-architecture)"; \
    case "${ARCH}" in \
      amd64)  VEGETA_ARCH="linux_amd64" ;; \
      arm64)  VEGETA_ARCH="linux_arm64" ;; \
      *)      echo "Unsupported architecture: ${ARCH}" && exit 1 ;; \
    esac; \
    curl -fsSL "https://github.com/tsenart/vegeta/releases/download/v${VEGETA_VERSION}/vegeta_${VEGETA_VERSION}_${VEGETA_ARCH}.tar.gz" \
      -o /tmp/vegeta.tar.gz; \
    tar -xzf /tmp/vegeta.tar.gz -C /tmp vegeta; \
    mv /tmp/vegeta /usr/local/bin/vegeta; \
    chmod +x /usr/local/bin/vegeta; \
    rm /tmp/vegeta.tar.gz; \
    vegeta --version

WORKDIR /app

COPY pyproject.toml ./
COPY runner runner

RUN pip install --no-cache-dir requests

# Run as a non-root user (matches guidellm.Dockerfile).
RUN useradd --create-home --shell /sbin/nologin runner
USER runner

# Generic wrapper (#53 Phase 3); vegeta is invoked via /bin/sh -c '<pipeline>'
# argv produced by `packages/tool-adapters/src/vegeta/runtime.ts`.
ENTRYPOINT ["python", "-m", "runner"]
