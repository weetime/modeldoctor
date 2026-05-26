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
# use a pre-downloaded vegeta binary (fetched by build-runner-images.sh on
# the host before docker build, to avoid TLS failures inside the builder).
# Pin to v12.13.0 — bumping is a deliberate PR; update SHA256 constants in
# build-runner-images.sh alongside the version bump.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# TARGETARCH is auto-populated by BuildKit ("amd64" or "arm64").
# build-runner-images.sh downloads both binaries to images/.vegeta-binaries/
# before invoking docker build; the directory is gitignored.
ARG TARGETARCH
COPY images/.vegeta-binaries/vegeta_linux_${TARGETARCH} /usr/local/bin/vegeta
RUN chmod 0755 /usr/local/bin/vegeta && vegeta --version

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
