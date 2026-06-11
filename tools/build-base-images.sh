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
EVALSCOPE_VERSION=1.7.0
AIPERF_VERSION=0.10.0
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
    vegeta|evalscope|aiperf) TOOLS+=("$arg") ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done
if [[ ${#TOOLS[@]} -eq 0 ]]; then
  TOOLS=(vegeta evalscope aiperf)
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
cleanup() { for d in "${CLEANUP_DIRS[@]}"; do rm -rf "$d"; done; }
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
# Build
# ---------------------------------------------------------------------------
contains vegeta    "${TOOLS[@]}" && build_and_push vegeta    "$VEGETA_VERSION"
contains evalscope "${TOOLS[@]}" && build_and_push evalscope "$EVALSCOPE_VERSION"
contains aiperf    "${TOOLS[@]}" && build_and_push aiperf    "$AIPERF_VERSION"

echo
echo "==> Done. Base images in ${REGISTRY}:"
contains vegeta    "${TOOLS[@]}" && echo "    md-base-vegeta:${VEGETA_VERSION}"
contains evalscope "${TOOLS[@]}" && echo "    md-base-evalscope:${EVALSCOPE_VERSION}"
contains aiperf    "${TOOLS[@]}" && echo "    md-base-aiperf:${AIPERF_VERSION}"
echo
echo "Next: run ./tools/build-runner-images.sh to build + import the runner images."
