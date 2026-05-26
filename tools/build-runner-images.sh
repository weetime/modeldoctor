#!/usr/bin/env bash
# Build all benchmark-runner wrapper images and import into the
# local k3d cluster. Tag is the short git SHA of the most recent commit
# that touched apps/benchmark-runner/, so devs never need to remember
# to bump :devN — pulling the branch + running this script always
# produces a tag that matches the source state.
#
# Usage:
#   ./tools/build-runner-images.sh           # build + import to k3d cluster "modeldoctor"
#   ./tools/build-runner-images.sh --no-import   # build only, skip k3d import
#   K3D_CLUSTER=other ./tools/build-runner-images.sh  # different cluster

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# vegeta pre-download — fetch both arch binaries on the host (where TLS works)
# so the Dockerfile can COPY them instead of curling inside the builder.
# ---------------------------------------------------------------------------
VEGETA_VERSION=12.13.0
VEGETA_SHA256_AMD64=e8759ce45c14e18374bdccd3ba6068197bc3a9f9b7e484db3837f701b9d12e61
VEGETA_SHA256_ARM64=950381173a5575e25e8e086f36fc03bf65d61a2433329b48e41e1cb5e4133bba
VEGETA_BIN_DIR="apps/benchmark-runner/images/.vegeta-binaries"

mkdir -p "$VEGETA_BIN_DIR"
trap 'rm -rf "$VEGETA_BIN_DIR"' EXIT

for ARCH in amd64 arm64; do
  DEST="$VEGETA_BIN_DIR/vegeta_linux_${ARCH}"
  if [[ -f "$DEST" ]]; then
    echo "==> vegeta_linux_${ARCH} already present, skipping download"
    continue
  fi
  URL="https://github.com/tsenart/vegeta/releases/download/v${VEGETA_VERSION}/vegeta_${VEGETA_VERSION}_linux_${ARCH}.tar.gz"
  TARBALL="/tmp/vegeta_${ARCH}.tar.gz"
  echo "==> Downloading vegeta v${VEGETA_VERSION} (${ARCH})"
  curl -fsSL "$URL" -o "$TARBALL"
  if [[ "$ARCH" == "amd64" ]]; then SHA="$VEGETA_SHA256_AMD64"; else SHA="$VEGETA_SHA256_ARM64"; fi
  echo "${SHA}  ${TARBALL}" | sha256sum -c -
  tar -xzf "$TARBALL" -C "$VEGETA_BIN_DIR" vegeta
  mv "$VEGETA_BIN_DIR/vegeta" "$DEST"
  rm "$TARBALL"
done
# ---------------------------------------------------------------------------

# Compute content-addressed tag from the latest commit affecting the
# runner subtree. Falls back to the current HEAD if no path filter
# matches (e.g. on a fresh worktree before any runner change).
TAG="$(git log -1 --format=%h -- apps/benchmark-runner/ 2>/dev/null || true)"
if [[ -z "${TAG:-}" ]]; then
  TAG="$(git rev-parse --short HEAD)"
fi

# If there are uncommitted changes in the runner subtree, append a
# dirty-marker plus a timestamp. Plain `-dirty` would not distinguish
# two consecutive iterative builds (same tag → docker/k8s cache hits,
# stale image). Timestamp guarantees each iterative build gets a
# unique tag so k3d image import + pod restart picks it up.
if [[ -n "$(git status --porcelain apps/benchmark-runner/)" ]]; then
  TAG="${TAG}-dirty-$(date +%s)"
fi

K3D_CLUSTER="${K3D_CLUSTER:-modeldoctor}"
IMPORT=true
if [[ "${1:-}" == "--no-import" ]]; then
  IMPORT=false
fi

echo "==> Building runner images at tag :$TAG"

for tool in guidellm vegeta prefix-cache-probe evalscope aiperf; do
  image="md-runner-${tool}:${TAG}"
  echo "==> docker build $image"
  docker build \
    -f "apps/benchmark-runner/images/${tool}.Dockerfile" \
    -t "$image" \
    apps/benchmark-runner/
done

if [[ "$IMPORT" == "true" ]]; then
  echo "==> k3d image import (cluster: $K3D_CLUSTER)"
  k3d image import \
    "md-runner-guidellm:${TAG}" \
    "md-runner-vegeta:${TAG}" \
    "md-runner-prefix-cache-probe:${TAG}" \
    "md-runner-evalscope:${TAG}" \
    "md-runner-aiperf:${TAG}" \
    -c "$K3D_CLUSTER"
fi

echo
echo "==> Done. Set these in your .env (or export RUNNER_IMAGE_TAG=$TAG):"
echo "RUNNER_IMAGE_GUIDELLM=md-runner-guidellm:${TAG}"
echo "RUNNER_IMAGE_VEGETA=md-runner-vegeta:${TAG}"
echo "RUNNER_IMAGE_PREFIX_CACHE_PROBE=md-runner-prefix-cache-probe:${TAG}"
echo "RUNNER_IMAGE_EVALSCOPE=md-runner-evalscope:${TAG}"
echo "RUNNER_IMAGE_AIPERF=md-runner-aiperf:${TAG}"
