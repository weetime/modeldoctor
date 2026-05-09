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

# Patch genai-perf 0.0.16 for the OpenAI-spec usage-only final stream chunk.
#
# Why: when streaming, vLLM / Higress / OpenAI itself all emit a final
#   `data: {"choices":[],"usage":{...}}` chunk per OpenAI spec. genai-perf
#   0.0.16's `_extract_openai_chat_text_output` does
#   `completions = data.get("choices", [{}])[0]`, which returns `[]` (not the
#   default `[{}]`) and then IndexErrors on `[0]`. Higress's ai-statistics
#   plugin forces `include_usage` regardless of the client request, so this
#   bug fires on EVERY streaming run through Higress.
#
# Tracking: https://github.com/triton-inference-server/server/issues/8082
#
# What we change: replace the one offending line with an early `return ""`
# when `choices` is empty (semantically: "this chunk has no text payload").
# Backup, sed, diff for build-log audit, then a grep gate so the build
# fails loudly if upstream ever renames the line we're patching.
RUN F=/usr/local/lib/python3.11/site-packages/genai_perf/profile_data_parser/llm_profile_data_parser.py \
 && cp "$F" "$F.bak" \
 && sed -i 's|        completions = data.get("choices", \[{}\])\[0\]|        choices = data.get("choices", [])\n        if not choices:\n            return ""  # OpenAI spec: usage-only final chunk has empty choices\n        completions = choices[0]|' "$F" \
 && diff -u "$F.bak" "$F" || true \
 && grep -q 'if not choices:' "$F" || (echo "PATCH FAILED" && exit 1) \
 && rm "$F.bak"

WORKDIR /app

# Copy the wrapper. Tests are excluded by .dockerignore.
COPY runner runner

# Run as a non-root user (matches guidellm.Dockerfile / vegeta.Dockerfile).
RUN useradd --create-home --shell /sbin/nologin runner \
    && chown -R runner:runner /app
USER runner

# Generic wrapper (#53 Phase 3); genai-perf is invoked via /bin/sh -c
# wrapper produced by `packages/tool-adapters/src/genai-perf/runtime.ts`.
ENTRYPOINT ["python", "-m", "runner"]
