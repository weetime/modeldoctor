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
AIPERF_VERSION=0.7.0

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
PUSH=true
TOOLS=()
for arg in "$@"; do
  case "$arg" in
    --no-push) PUSH=false ;;
    vegeta|evalscope|aiperf) TOOLS+=("$arg") ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done
# default: all three
if [[ ${#TOOLS[@]} -eq 0 ]]; then
  TOOLS=(vegeta evalscope aiperf)
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
contains() { local e; for e in "${@:2}"; do [[ "$e" == "$1" ]] && return 0; done; return 1; }

build_and_push() {
  local tool="$1" version="$2"
  local image="${REGISTRY}/md-base-${tool}:${version}"
  echo
  echo "==> Building ${image}"
  docker build \
    -f "${CONTEXT}/images/${tool}.base.Dockerfile" \
    -t "$image" \
    "$CONTEXT"
  if [[ "$PUSH" == "true" ]]; then
    echo "==> Pushing ${image}"
    docker push "$image"
  fi
}

# ---------------------------------------------------------------------------
# vegeta: pre-download binary on host.
# Docker Desktop for Mac fails TLS handshakes to github.com inside the
# builder (curl error 35). The host network has no such issue.
# ---------------------------------------------------------------------------
VEGETA_BIN_DIR="${CONTEXT}/images/.vegeta-binaries"
if contains vegeta "${TOOLS[@]}"; then
  mkdir -p "$VEGETA_BIN_DIR"
  trap 'rm -rf "$VEGETA_BIN_DIR"' EXIT

  for ARCH in amd64 arm64; do
    DEST="${VEGETA_BIN_DIR}/vegeta_linux_${ARCH}"
    if [[ -f "$DEST" ]]; then
      echo "==> vegeta_linux_${ARCH} already present, skipping download"
      continue
    fi
    URL="https://github.com/tsenart/vegeta/releases/download/v${VEGETA_VERSION}/vegeta_${VEGETA_VERSION}_linux_${ARCH}.tar.gz"
    TARBALL="/tmp/vegeta_base_${ARCH}.tar.gz"
    echo "==> Downloading vegeta v${VEGETA_VERSION} (${ARCH})"
    curl -fsSL "$URL" -o "$TARBALL"
    if [[ "$ARCH" == "amd64" ]]; then SHA="$VEGETA_SHA256_AMD64"; else SHA="$VEGETA_SHA256_ARM64"; fi
    echo "${SHA}  ${TARBALL}" | sha256sum -c -
    tar -xzf "$TARBALL" -C "$VEGETA_BIN_DIR" vegeta
    mv "${VEGETA_BIN_DIR}/vegeta" "$DEST"
    rm "$TARBALL"
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
