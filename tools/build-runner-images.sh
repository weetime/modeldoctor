#!/usr/bin/env bash
# Build all three benchmark-runner wrapper images and import into the
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

# Compute content-addressed tag from the latest commit affecting the
# runner subtree. Falls back to the current HEAD if no path filter
# matches (e.g. on a fresh worktree before any runner change).
TAG="$(git log -1 --format=%h -- apps/benchmark-runner/ 2>/dev/null || true)"
if [[ -z "${TAG:-}" ]]; then
  TAG="$(git rev-parse --short HEAD)"
fi

K3D_CLUSTER="${K3D_CLUSTER:-modeldoctor}"
IMPORT=true
if [[ "${1:-}" == "--no-import" ]]; then
  IMPORT=false
fi

echo "==> Building runner images at tag :$TAG"

for tool in guidellm vegeta genai-perf; do
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
    "md-runner-genai-perf:${TAG}" \
    -c "$K3D_CLUSTER"
fi

echo
echo "==> Done. Set these in your .env (or export RUNNER_IMAGE_TAG=$TAG):"
echo "RUNNER_IMAGE_GUIDELLM=md-runner-guidellm:${TAG}"
echo "RUNNER_IMAGE_VEGETA=md-runner-vegeta:${TAG}"
echo "RUNNER_IMAGE_GENAI_PERF=md-runner-genai-perf:${TAG}"
