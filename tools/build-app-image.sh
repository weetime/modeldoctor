#!/usr/bin/env bash
# 构建 ModelDoctor 应用镜像(api + web 同一个镜像)并推送到镜像仓库。
#
# 华为云 SWR 拒收 buildx 直接推送的 OCI image index(HTTP 400 "fail to parse"),
# 所以这里不用 `buildx --platform a,b --push`,而是:
#   1. 每个架构单独 build+push 成 <tag>-<arch>
#   2. 用 docker manifest 合成 Docker v2 manifest list
# 这是 SWR 唯一能正确解析的多架构形式。
set -euo pipefail

REGISTRY="${REGISTRY:-swr.cn-north-4.myhuaweicloud.com}"
PROJECT="${PROJECT:-modeldoctor}"
IMAGE_NAME="${IMAGE_NAME:-modeldoctor}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
TAG=""
PUSH=0

usage() {
  cat <<'USAGE'
用法: tools/build-app-image.sh --tag <tag> [选项]

选项:
  --tag <tag>           必填,镜像 tag(通常是 git tag,如 v0.1.0)
  --push                构建后推送(不加则只在本地构建宿主机架构镜像供验证)
  --platforms <list>    默认 linux/amd64,linux/arm64
  --registry <host>     默认 swr.cn-north-4.myhuaweicloud.com
  --project <org>       默认 modeldoctor
环境变量 REGISTRY / PROJECT / IMAGE_NAME / PLATFORMS 同名可覆盖。
前置条件: 推送前需先 docker login <registry>;`docker manifest` 依赖的
experimental CLI 特性由脚本自动开启,无需手动配置。
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)
      [[ $# -ge 2 ]] || { echo "错误: --tag 需要一个值" >&2; usage; exit 1; }
      TAG="$2"; shift 2 ;;
    --push) PUSH=1; shift ;;
    --platforms)
      [[ $# -ge 2 ]] || { echo "错误: --platforms 需要一个值" >&2; usage; exit 1; }
      PLATFORMS="$2"; shift 2 ;;
    --registry)
      [[ $# -ge 2 ]] || { echo "错误: --registry 需要一个值" >&2; usage; exit 1; }
      REGISTRY="$2"; shift 2 ;;
    --project)
      [[ $# -ge 2 ]] || { echo "错误: --project 需要一个值" >&2; usage; exit 1; }
      PROJECT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; usage; exit 1 ;;
  esac
done

[[ -n "$TAG" ]] || { echo "错误: --tag 必填" >&2; usage; exit 1; }

# `docker manifest` 命令历史上是 CLI 的 experimental 特性,需要
# DOCKER_CLI_EXPERIMENTAL=enabled 或 ~/.docker/config.json 里的
# "experimental": "enabled" 才能用。Docker Desktop 默认已开启,但 Task 11
# 的 release workflow 跑在 GitHub Actions 的 vanilla Docker Engine 上,
# 默认未开启。这里显式导出:已开启的环境里是无害的幂等设置,CI 里能省掉
# 一次排障。
export DOCKER_CLI_EXPERIMENTAL=enabled

REPO="${REGISTRY}/${PROJECT}/${IMAGE_NAME}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

IFS=',' read -r -a PLATFORM_ARR <<< "$PLATFORMS"

if [[ "$PUSH" -eq 0 ]]; then
  echo "==> 本地构建(不推送): ${REPO}:${TAG}"
  docker build -t "${REPO}:${TAG}" "$ROOT"
  echo "==> 完成。加 --push 才会推送并合成 manifest list。"
  exit 0
fi

ARCH_TAGS=()
for platform in "${PLATFORM_ARR[@]}"; do
  arch="${platform##*/}"
  arch_tag="${REPO}:${TAG}-${arch}"
  echo "==> 构建并推送 ${arch_tag}"
  docker buildx build \
    --platform "$platform" \
    --tag "$arch_tag" \
    --provenance=false \
    --sbom=false \
    --push \
    "$ROOT"
  ARCH_TAGS+=("$arch_tag")
done

echo "==> 合成 manifest list ${REPO}:${TAG}"
docker manifest rm "${REPO}:${TAG}" >/dev/null 2>&1 || true
docker manifest create "${REPO}:${TAG}" "${ARCH_TAGS[@]}"
for platform in "${PLATFORM_ARR[@]}"; do
  arch="${platform##*/}"
  docker manifest annotate "${REPO}:${TAG}" "${REPO}:${TAG}-${arch}" \
    --os "${platform%%/*}" --arch "$arch"
done
docker manifest push "${REPO}:${TAG}"

echo "==> 完成: ${REPO}:${TAG}"
docker manifest inspect "${REPO}:${TAG}" | head -40
