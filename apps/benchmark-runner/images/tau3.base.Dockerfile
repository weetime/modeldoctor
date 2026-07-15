# syntax=docker/dockerfile:1.6
# Base image for the tau3 (tau2-bench) runner.
# Contains the apt toolchain + tau2-bench install + baked data — NO ModelDoctor
# runner scripts. Rebuild and push only when the tau2 version or the baked data
# changes:
#
#   ./tools/build-base-images.sh tau3
#
# The image TAG (TAU3_IMAGE_TAG in build-base-images.sh) tracks the base
# *content* version and is decoupled from the tau2 git ref (TAU3_REF below):
# bump the tag whenever the baked content changes even if the tau2 ref stays
# put. Then update tau3.Dockerfile's FROM line to the new tag.
#
# tau2-bench requires Python >=3.12 (the benchmark-runner wrapper floor is
# 3.11), so this is the ONLY image in images/ on 3.12.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# System deps:
#  - git: clone tau2-bench (only needed at build).
#  - gcc + python3-dev + portaudio19-dev: τ³ v1.0.0 has an upstream packaging
#    bug — `tau2/__init__.py` and `registry.py` EAGERLY import the voice +
#    knowledge modules at top level even though those deps are declared optional
#    in pyproject. So EVERY `import tau2.*` (incl. our summarizer's
#    `from tau2.data_model...`) fails unless the full voice+knowledge stack is
#    present. voice drags pyaudio, which has no wheel and needs portaudio dev
#    headers + a C compiler to build. We run text-only but must satisfy the
#    eager import chain; libportaudio (pulled by portaudio19-dev) must remain at
#    runtime since pyaudio loads it at import. See task-17b image-fix report.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git gcc python3-dev portaudio19-dev \
    && rm -rf /var/lib/apt/lists/*

# Pin the τ³-bench release tag for reproducibility.
# Bump deliberately via a PR — tau2's CLI surface feeds packages/tool-adapters/
# src/tau3/build-command.ts directly, so an upstream flag/behavior change must
# be caught by tau2's own runtime tests, not silently picked up on rebuild.
ARG TAU3_REF=v1.0.0

# Clone + install tau2-bench (editable, src-layout: source stays at
# /opt/tau2/src/tau2 — repo root /opt/tau2 has NO top-level `tau2/` dir, so it
# can never shadow the installed package via an implicit CWD sys.path entry).
#
# The upstream repo ships ~800 MB of `data/` (baseline leaderboard result
# dumps under data/tau2/results/, voice/audio assets) that our text-only
# airline/retail/telecom runs never touch — trim them in this layer so they
# never enter an image layer.
#
# tau2.utils.utils.DATA_DIR resolves to TAU2_DATA_DIR if set, else
# `<package source dir>/../../../data` (i.e. /opt/tau2/data for an editable
# install) — verified against the cloned source. We pin it explicitly with
# TAU2_DATA_DIR below anyway so behavior doesn't depend on __file__
# introspection surviving future tau2 refactors.
RUN git clone https://github.com/sierra-research/tau2-bench.git /opt/tau2 \
    && cd /opt/tau2 \
    && git checkout "${TAU3_REF}" \
    && rm -rf .git data/tau2/results data/voice \
    && pip install --no-cache-dir -e '.[voice,knowledge]'

ENV TAU2_DATA_DIR=/opt/tau2/data
RUN tau2 check-data
