# syntax=docker/dockerfile:1.6

# Why Python base for a Go tool? guidellm and (Phase 4) genai-perf are Python,
# so the wrapper at apps/benchmark-runner/runner is Python — keeping it as one
# codebase for all three tools is worth ~120 MB on the vegeta image vs
# rewriting it in Go.

# Phase 3 of #53: vegeta runner image. Layers our Python wrapper on top
# of a pinned vegeta CLI binary. Unlike guidellm (Python), vegeta is a
# single Go static binary, so the image is small (~120 MB Python slim +
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
ARG VEGETA_SHA256_AMD64=e8759ce45c14e18374bdccd3ba6068197bc3a9f9b7e484db3837f701b9d12e61
ARG VEGETA_SHA256_ARM64=950381173a5575e25e8e086f36fc03bf65d61a2433329b48e41e1cb5e4133bba
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends curl ca-certificates; \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*.deb; \
    ARCH="$(dpkg --print-architecture)"; \
    case "${ARCH}" in \
      amd64)  VEGETA_ARCH="linux_amd64"; VEGETA_SHA="${VEGETA_SHA256_AMD64}" ;; \
      arm64)  VEGETA_ARCH="linux_arm64"; VEGETA_SHA="${VEGETA_SHA256_ARM64}" ;; \
      *)      echo "Unsupported architecture: ${ARCH}" && exit 1 ;; \
    esac; \
    curl -fsSL "https://github.com/tsenart/vegeta/releases/download/v${VEGETA_VERSION}/vegeta_${VEGETA_VERSION}_${VEGETA_ARCH}.tar.gz" \
      -o /tmp/vegeta.tar.gz; \
    echo "${VEGETA_SHA}  /tmp/vegeta.tar.gz" | sha256sum -c -; \
    tar -xzf /tmp/vegeta.tar.gz -C /tmp vegeta; \
    install -m 0755 /tmp/vegeta /usr/local/bin/vegeta; \
    rm /tmp/vegeta.tar.gz; \
    vegeta --version

WORKDIR /app

COPY runner runner

# Pinned to match pyproject.toml's requests>=2.31,<3 declaration. Don't drop
# the version constraint here — pip install requests is otherwise unconstrained
# and will silently grab requests 3.x when it ships.
RUN pip install --no-cache-dir 'requests>=2.31,<3'

# Run as a non-root user (matches guidellm.Dockerfile).
RUN useradd --create-home --shell /sbin/nologin runner \
    && chown -R runner:runner /app
USER runner

# Generic wrapper (#53 Phase 3); vegeta is invoked via /bin/sh -c '<pipeline>'
# argv produced by `packages/tool-adapters/src/vegeta/runtime.ts`.
ENTRYPOINT ["python", "-m", "runner"]
