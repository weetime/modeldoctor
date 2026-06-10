#!/usr/bin/env bash
# Build all benchmark-runner wrapper images and import into the local k3d cluster.
# Tag is the short git SHA of the most recent commit that touched
# apps/benchmark-runner/, so devs never need to remember to bump :devN.
#
# Runner images are thin: they just COPY runner/ on top of stable base images
# already in ghcr.io/weetime/. Run build-base-images.sh first if the base
# images are not yet in the registry or need a version bump.
#
# Usage:
#   ./tools/build-runner-images.sh                      # build + import all five
#   ./tools/build-runner-images.sh vegeta evalscope     # specific tools only
#   ./tools/build-runner-images.sh --no-import          # build only, skip k3d import
#   K3D_CLUSTER=other ./tools/build-runner-images.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Compute content-addressed tag from the latest commit affecting the
# runner subtree. Falls back to HEAD if no path filter matches (e.g. on a
# fresh worktree before any runner change).
TAG="$(git log -1 --format=%h -- apps/benchmark-runner/ 2>/dev/null || true)"
if [[ -z "${TAG:-}" ]]; then
  TAG="$(git rev-parse --short HEAD)"
fi

# Append dirty-marker + timestamp for uncommitted changes so each iterative
# build gets a unique tag (plain -dirty would collide on consecutive builds).
if [[ -n "$(git status --porcelain apps/benchmark-runner/)" ]]; then
  TAG="${TAG}-dirty-$(date +%s)"
fi

K3D_CLUSTER="${K3D_CLUSTER:-modeldoctor}"
IMPORT=true
TOOLS=()
for arg in "$@"; do
  case "$arg" in
    --no-import) IMPORT=false ;;
    guidellm|vegeta|evalscope|aiperf) TOOLS+=("$arg") ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done
if [[ ${#TOOLS[@]} -eq 0 ]]; then
  TOOLS=(guidellm vegeta evalscope aiperf)
fi

echo "==> Runner images at tag :$TAG (tools: ${TOOLS[*]})"

for tool in "${TOOLS[@]}"; do
  image="md-runner-${tool}:${TAG}"
  if docker image inspect "$image" >/dev/null 2>&1; then
    echo "==> ${image} already exists locally, skipping build"
  else
    echo "==> docker build ${image}"
    docker build \
      -f "apps/benchmark-runner/images/${tool}.Dockerfile" \
      -t "$image" \
      apps/benchmark-runner/
  fi
done

if [[ "$IMPORT" == "true" ]]; then
  echo "==> k3d image import (cluster: $K3D_CLUSTER)"
  IMPORT_ARGS=()
  for tool in "${TOOLS[@]}"; do IMPORT_ARGS+=("md-runner-${tool}:${TAG}"); done
  k3d image import "${IMPORT_ARGS[@]}" -c "$K3D_CLUSTER"
fi

echo
echo "==> Done. Set these in your .env (or export RUNNER_IMAGE_TAG=$TAG):"
for tool in "${TOOLS[@]}"; do
  VAR="RUNNER_IMAGE_$(echo "$tool" | tr '-' '_' | tr '[:lower:]' '[:upper:]')"
  echo "${VAR}=md-runner-${tool}:${TAG}"
done
