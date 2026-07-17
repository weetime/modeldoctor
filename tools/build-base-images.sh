#!/usr/bin/env bash
# Build and push benchmark-runner BASE images to ghcr.io/weetime/.
#
# Base images contain the upstream tool + any baked-in datasets but NO
# ModelDoctor runner scripts. They are rebuilt only when the underlying tool
# version bumps; the runner images (build-runner-images.sh) then layer our
# thin wrapper on top, so dev-loop rebuilds only touch the wrapper.
#
# Usage:
#   ./tools/build-base-images.sh                  # build + push all three
#   ./tools/build-base-images.sh vegeta            # single tool
#   ./tools/build-base-images.sh evalscope aiperf  # two tools
#   ./tools/build-base-images.sh --no-push         # local test, skip push
#   ./tools/build-base-images.sh --force           # rebuild even if tag already in registry

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

REGISTRY="ghcr.io/weetime"
CONTEXT="apps/benchmark-runner"

# ---------------------------------------------------------------------------
# Version pins — update here AND in the corresponding *.base.Dockerfile ARG
# default AND in the runner Dockerfile's FROM tag when bumping a tool.
# ---------------------------------------------------------------------------
VEGETA_VERSION=12.13.0
VEGETA_SHA256_AMD64=e8759ce45c14e18374bdccd3ba6068197bc3a9f9b7e484db3837f701b9d12e61
VEGETA_SHA256_ARM64=950381173a5575e25e8e086f36fc03bf65d61a2433329b48e41e1cb5e4133bba
# evalscope pip version (baked via the Dockerfile ARG default) is decoupled from
# the base image TAG: bump EVALSCOPE_IMAGE_TAG whenever the baked datasets change
# even if the evalscope pip version stays put. 1.7.1 added the swift/sharegpt
# EN+ZH corpora on top of evalscope 1.7.0.
EVALSCOPE_VERSION=1.7.0
EVALSCOPE_IMAGE_TAG=1.7.1
AIPERF_VERSION=0.10.0
# tau3: TAU3_REF (tau2 git tag, baked via the Dockerfile ARG default) is
# decoupled from the base image TAG: bump TAU3_IMAGE_TAG whenever the baked
# content changes even if the tau2 ref stays put, then update tau3.Dockerfile's
# FROM line to match.
TAU3_IMAGE_TAG=1.0.0
# vllm-omni-bench: VLLM_OMNI_VERSION (upstream vllm-omni image tag, baked via
# the Dockerfile ARG default) is decoupled from the base image TAG — bump
# VLLM_OMNI_BENCH_IMAGE_TAG whenever the baked tokenizers change even if the
# upstream vllm-omni version stays put, then update vllm-omni-bench.Dockerfile's
# FROM line to match.
VLLM_OMNI_VERSION=v0.24.0
VLLM_OMNI_BENCH_IMAGE_TAG=0.24.0
SHAREGPT_URL="https://huggingface.co/datasets/anon8231489123/ShareGPT_Vicuna_unfiltered/resolve/main/ShareGPT_V3_unfiltered_cleaned_split.json"
MOONCAKE_TRACE_BASEURL="https://raw.githubusercontent.com/kvcache-ai/Mooncake/main/FAST25-release/traces"

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
PUSH=true
FORCE=false
TOOLS=()
for arg in "$@"; do
  case "$arg" in
    --no-push) PUSH=false ;;
    --force)   FORCE=true ;;
    vegeta|evalscope|aiperf|tau3|vllm-omni-bench) TOOLS+=("$arg") ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done
if [[ ${#TOOLS[@]} -eq 0 ]]; then
  TOOLS=(vegeta evalscope aiperf tau3 vllm-omni-bench)
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
contains() { local e; for e in "${@:2}"; do [[ "$e" == "$1" ]] && return 0; done; return 1; }

# Returns 0 if the image manifest already exists in the remote registry.
image_exists_remote() { docker buildx imagetools inspect "$1" >/dev/null 2>&1; }

# Cross-platform SHA256 check (Linux: sha256sum, macOS: shasum -a 256).
verify_sha256() {
  local file="$1" expected="$2"
  if command -v sha256sum >/dev/null 2>&1; then
    echo "${expected}  ${file}" | sha256sum -c -
  elif command -v shasum >/dev/null 2>&1; then
    echo "${expected}  ${file}" | shasum -a 256 -c -
  else
    echo "Error: neither sha256sum nor shasum is available." >&2
    exit 1
  fi
}

build_and_push() {
  local tool="$1" version="$2"
  local image="${REGISTRY}/md-base-${tool}:${version}"
  echo
  # Skip if already exists: remote registry check for push mode, local image check for --no-push.
  if [[ "$FORCE" == "false" ]]; then
    if [[ "$PUSH" == "true" ]] && image_exists_remote "$image"; then
      echo "==> ${image} already in registry, skipping (use --force to rebuild)"
      return
    elif [[ "$PUSH" == "false" ]] && docker image inspect "$image" >/dev/null 2>&1; then
      echo "==> ${image} already built locally, skipping (use --force to rebuild)"
      return
    fi
  fi
  if [[ "$PUSH" == "true" ]]; then
    # Multi-platform push via buildx so amd64 and arm64 users share one tag.
    echo "==> Building + pushing multi-platform ${image}"
    docker buildx build \
      --platform linux/amd64,linux/arm64 \
      -f "${CONTEXT}/images/${tool}.base.Dockerfile" \
      -t "$image" \
      --push \
      "$CONTEXT"
  else
    # Local test: single-arch docker build (no cross-compilation needed).
    echo "==> Building ${image} (local, current arch only)"
    docker build \
      -f "${CONTEXT}/images/${tool}.base.Dockerfile" \
      -t "$image" \
      "$CONTEXT"
  fi
}

# ---------------------------------------------------------------------------
# Cleanup on exit (trap accumulates paths as downloads proceed)
# ---------------------------------------------------------------------------
CLEANUP_DIRS=()
# Guard the expansion: under `set -u` on bash 3.2 (macOS default), expanding an
# empty array as "${CLEANUP_DIRS[@]}" is an unbound-variable error, which fires
# in the EXIT trap and makes the script exit 1 even after a successful push
# (e.g. when building only evalscope, which never appends a cleanup dir).
cleanup() {
  [[ ${#CLEANUP_DIRS[@]} -gt 0 ]] || return 0
  for d in "${CLEANUP_DIRS[@]}"; do rm -rf "$d"; done
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# vegeta: pre-download binaries on host.
# Docker Desktop for Mac fails TLS handshakes to github.com inside the builder
# (curl error 35). The host network has no such issue.
# ---------------------------------------------------------------------------
if contains vegeta "${TOOLS[@]}"; then
  VEGETA_BIN_DIR="${CONTEXT}/images/.vegeta-binaries"
  mkdir -p "$VEGETA_BIN_DIR"
  CLEANUP_DIRS+=("$VEGETA_BIN_DIR")

  for ARCH in amd64 arm64; do
    DEST="${VEGETA_BIN_DIR}/vegeta_linux_${ARCH}"
    if [[ -f "$DEST" ]]; then
      echo "==> vegeta_linux_${ARCH} already present, skipping download"
      continue
    fi
    URL="https://github.com/tsenart/vegeta/releases/download/v${VEGETA_VERSION}/vegeta_${VEGETA_VERSION}_linux_${ARCH}.tar.gz"
    TARBALL="/tmp/vegeta_base_${ARCH}.tar.gz"
    echo "==> Downloading vegeta v${VEGETA_VERSION} (${ARCH})"
    curl -fsSL --retry 3 --retry-delay 5 "$URL" -o "$TARBALL"
    if [[ "$ARCH" == "amd64" ]]; then SHA="$VEGETA_SHA256_AMD64"; else SHA="$VEGETA_SHA256_ARM64"; fi
    verify_sha256 "$TARBALL" "$SHA"
    tar -xzf "$TARBALL" -C "$VEGETA_BIN_DIR" vegeta
    mv "${VEGETA_BIN_DIR}/vegeta" "$DEST"
    rm "$TARBALL"
  done
fi

# ---------------------------------------------------------------------------
# aiperf: pre-download ShareGPT corpus on host.
# HuggingFace TLS also fails inside Docker Desktop for Mac (same root cause
# as vegeta/GitHub). Pre-downloading on the host avoids the builder's network.
# ---------------------------------------------------------------------------
if contains aiperf "${TOOLS[@]}"; then
  SHAREGPT_DIR="${CONTEXT}/images/.sharegpt"
  mkdir -p "$SHAREGPT_DIR"
  CLEANUP_DIRS+=("$SHAREGPT_DIR")

  SHAREGPT_FILE="${SHAREGPT_DIR}/ShareGPT_V3_unfiltered_cleaned_split.json"
  if [[ -f "$SHAREGPT_FILE" ]]; then
    echo "==> ShareGPT corpus already present, skipping download"
  else
    echo "==> Downloading ShareGPT V3 corpus (~672 MB)"
    curl -fL --retry 3 --retry-delay 5 --output "$SHAREGPT_FILE" "$SHAREGPT_URL"
  fi

  # Mooncake FAST25 traces (conversation ~3 MB, toolagent ~4 MB) for
  # dataset=mooncake-trace. Same host-side pre-download as ShareGPT.
  MOONCAKE_DIR="${CONTEXT}/images/.mooncake"
  mkdir -p "$MOONCAKE_DIR"
  CLEANUP_DIRS+=("$MOONCAKE_DIR")
  for TRACE in conversation_trace toolagent_trace; do
    MC_FILE="${MOONCAKE_DIR}/${TRACE}.jsonl"
    if [[ -f "$MC_FILE" ]]; then
      echo "==> Mooncake ${TRACE} already present, skipping download"
    else
      echo "==> Downloading Mooncake ${TRACE}"
      curl -fsSL --retry 3 --retry-delay 5 --output "$MC_FILE" "${MOONCAKE_TRACE_BASEURL}/${TRACE}.jsonl"
    fi
  done
fi

# ---------------------------------------------------------------------------
# vllm-omni-bench: pre-download known omni models' tokenizer files on host.
# Same TLS-workaround rationale as ShareGPT/vegeta (Docker Desktop for Mac
# fails TLS handshakes to huggingface.co inside the builder). Only tokenizer
# files (a few tens of MB each) are fetched — weights are excluded.
# ---------------------------------------------------------------------------
if contains vllm-omni-bench "${TOOLS[@]}"; then
  TOKENIZER_DIR="${CONTEXT}/images/.tokenizers"
  mkdir -p "$TOKENIZER_DIR"
  CLEANUP_DIRS+=("$TOKENIZER_DIR")

  for REPO in Qwen/Qwen2.5-Omni-7B Qwen/Qwen3-Omni-30B-A3B-Instruct; do
    DEST="${TOKENIZER_DIR}/${REPO}"
    if [[ -d "$DEST" && -n "$(ls -A "$DEST" 2>/dev/null)" ]]; then
      echo "==> tokenizer ${REPO} already present, skipping download"
      continue
    fi
    echo "==> Downloading tokenizer for ${REPO}"
    huggingface-cli download "$REPO" \
      --include "tokenizer*" "*.json" \
      --exclude "*.safetensors*" \
      --local-dir "$DEST"
  done
fi

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
contains vegeta          "${TOOLS[@]}" && build_and_push vegeta          "$VEGETA_VERSION"
contains evalscope       "${TOOLS[@]}" && build_and_push evalscope       "$EVALSCOPE_IMAGE_TAG"
contains aiperf          "${TOOLS[@]}" && build_and_push aiperf          "$AIPERF_VERSION"
contains tau3            "${TOOLS[@]}" && build_and_push tau3            "$TAU3_IMAGE_TAG"
contains vllm-omni-bench "${TOOLS[@]}" && build_and_push vllm-omni-bench "$VLLM_OMNI_BENCH_IMAGE_TAG"

echo
echo "==> Done. Base images in ${REGISTRY}:"
contains vegeta          "${TOOLS[@]}" && echo "    md-base-vegeta:${VEGETA_VERSION}"
contains evalscope       "${TOOLS[@]}" && echo "    md-base-evalscope:${EVALSCOPE_IMAGE_TAG}"
contains aiperf          "${TOOLS[@]}" && echo "    md-base-aiperf:${AIPERF_VERSION}"
contains tau3            "${TOOLS[@]}" && echo "    md-base-tau3:${TAU3_IMAGE_TAG}"
contains vllm-omni-bench "${TOOLS[@]}" && echo "    md-base-vllm-omni-bench:${VLLM_OMNI_BENCH_IMAGE_TAG}"
echo
echo "Next: run ./tools/build-runner-images.sh to build + import the runner images."
