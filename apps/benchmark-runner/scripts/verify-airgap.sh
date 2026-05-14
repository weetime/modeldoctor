#!/usr/bin/env bash
# Verify the evalscope + aiperf runner images can boot and access
# every baked dataset enum value WITHOUT network egress. Run after
# building the images locally (or against pulled :latest images).
#
# Usage:
#   ./apps/benchmark-runner/scripts/verify-airgap.sh
#   IMAGE_EVALSCOPE=md-runner-evalscope:dev ./apps/benchmark-runner/scripts/verify-airgap.sh
#   IMAGE_AIPERF=md-runner-aiperf:dev ./apps/benchmark-runner/scripts/verify-airgap.sh
#
# Adds nothing to CI today — manual gate for the deploying operator.

set -euo pipefail

EVALSCOPE_IMAGE="${IMAGE_EVALSCOPE:-md-runner-evalscope:dev}"
AIPERF_IMAGE="${IMAGE_AIPERF:-md-runner-aiperf:dev}"

pass() { printf "  \033[32m✓\033[0m %s\n" "$1"; }
fail() { printf "  \033[31m✗\033[0m %s\n" "$1"; exit 1; }

echo "==> evalscope (${EVALSCOPE_IMAGE})"
docker run --rm --network none --entrypoint /bin/sh "$EVALSCOPE_IMAGE" \
  -c 'test -d /opt/evalscope-datasets/longalpaca && ls /opt/evalscope-datasets/longalpaca | head -1' \
  >/dev/null && pass "longalpaca baked" || fail "longalpaca missing"

docker run --rm --network none --entrypoint /bin/sh "$EVALSCOPE_IMAGE" \
  -c 'test -s /opt/evalscope-datasets/openqa/open_qa.jsonl' \
  >/dev/null && pass "openqa baked (open_qa.jsonl)" || fail "openqa missing"

echo "==> aiperf (${AIPERF_IMAGE})"
docker run --rm --network none --entrypoint /bin/sh "$AIPERF_IMAGE" \
  -c 'test -s /app/.cache/aiperf/datasets/ShareGPT_V3_unfiltered_cleaned_split.json' \
  >/dev/null && pass "ShareGPT baked" || fail "ShareGPT missing"

echo
echo "==> all baked datasets present; air-gapped runs supported."
