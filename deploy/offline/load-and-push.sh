#!/usr/bin/env bash
# 离线交付包 · 现场侧:docker load 有网侧带来的 tar,把每个镜像重打标签推送到
# 客户自己的仓库(<registry>/<project>/<name>:<tag>),最后在 stdout 打印一段
# 可以直接 `helm install -f -` 使用的 values 覆盖片段。
#
# 要推送哪些镜像、各自原始 tag 是什么,不依赖任何外部清单文件——直接从 tar 自带的
# manifest.json(docker save 产物的标准结构)里读 RepoTags,这样现场只需要这一个
# tar 文件就是自描述的,不必额外携带 pull-and-save.sh 用的 images.txt 或 chart 源码。
#
# helm-test 用的 curl 镜像(curlimages/curl,对应 chart 的 values 字段 test.image)
# 同样会被 load + 重打标签 + 推送,并出现在下面打印的 values 片段里——
# 现场装完之后 `helm test` 拉的就是客户仓库里的那份副本,不用再单独处理。
set -euo pipefail

ARCHIVE=""
REGISTRY=""
PROJECT=""
DRY_RUN=0

usage() {
  cat <<'USAGE'
用法: deploy/offline/load-and-push.sh --archive <tar> --registry <host> --project <org> [选项]

选项:
  --archive <tar>    必填,pull-and-save.sh 生成的 modeldoctor-images-<tier>-<apptag>.tar
  --registry <host>  必填,客户仓库地址,如 registry.customer.local:5000
  --project <org>    必填,客户仓库里的项目/命名空间,如 modeldoctor
  --dry-run          只打印将要重打标签/推送的计划与 values 片段,不执行 docker 任何操作
  -h, --help         显示此帮助

前置条件: docker(推送前需先 `docker login -u <SWR_USERNAME> -p <SWR_PASSWORD> <registry>`,
本脚本和文档都不会写任何真实凭据)。
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --archive)
      [[ $# -ge 2 ]] || { echo "错误: --archive 需要一个值" >&2; usage; exit 1; }
      ARCHIVE="$2"; shift 2 ;;
    --registry)
      [[ $# -ge 2 ]] || { echo "错误: --registry 需要一个值" >&2; usage; exit 1; }
      REGISTRY="$2"; shift 2 ;;
    --project)
      [[ $# -ge 2 ]] || { echo "错误: --project 需要一个值" >&2; usage; exit 1; }
      PROJECT="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; usage; exit 1 ;;
  esac
done

[[ -n "$ARCHIVE" ]] || { echo "错误: --archive 必填" >&2; usage; exit 1; }
[[ -n "$REGISTRY" ]] || { echo "错误: --registry 必填" >&2; usage; exit 1; }
[[ -n "$PROJECT" ]] || { echo "错误: --project 必填" >&2; usage; exit 1; }
[[ -f "$ARCHIVE" ]] || { echo "错误: 归档文件不存在: ${ARCHIVE}" >&2; exit 1; }

# ---- 1. 从 tar 自带的 manifest.json 读出所有 RepoTags(不依赖 jq,只用 grep/sed,
#         减少现场机器需要预装的工具种类) ----------------------------------------
RAW_TAGS="$(tar -xO -f "$ARCHIVE" manifest.json 2>/dev/null \
  | grep -o '"RepoTags":\[[^]]*\]' \
  | sed -E 's/"RepoTags":\[//; s/\]//' \
  | tr ',' '\n' \
  | tr -d '"' \
  | sed '/^$/d')"

[[ -n "$RAW_TAGS" ]] || { echo "错误: 未能从 ${ARCHIVE} 的 manifest.json 里解析出任何 RepoTags,归档可能已损坏" >&2; exit 1; }

SRC_REFS=()
while IFS= read -r ref; do
  SRC_REFS+=("$ref")
done <<< "$RAW_TAGS"

# ---- 2. 计算重打标签计划:<registry>/<project>/<repo 最后一段>:<原 tag> --------
TARGET_REFS=()
for src in "${SRC_REFS[@]}"; do
  tag="${src##*:}"
  without_tag="${src%:*}"
  name="${without_tag##*/}"
  TARGET_REFS+=("${REGISTRY}/${PROJECT}/${name}:${tag}")
done

echo "==> 重打标签计划(共 ${#SRC_REFS[@]} 个镜像):"
for i in "${!SRC_REFS[@]}"; do
  echo "    ${SRC_REFS[$i]}  ->  ${TARGET_REFS[$i]}"
done

# ---- 3. 按 name 分类,准备 values 覆盖片段 ------------------------------------
APP_TAG=""; APP_TARGET=""
POSTGRES_TARGET=""
MINIO_TARGET=""
MC_TARGET=""
CURL_TARGET=""
RUNNER_LINES=()

for i in "${!SRC_REFS[@]}"; do
  src="${SRC_REFS[$i]}"
  target="${TARGET_REFS[$i]}"
  tag="${src##*:}"
  without_tag="${src%:*}"
  name="${without_tag##*/}"
  case "$name" in
    modeldoctor) APP_TAG="$tag"; APP_TARGET="$target" ;;
    postgres) POSTGRES_TARGET="$target" ;;
    minio) MINIO_TARGET="$target" ;;
    mc) MC_TARGET="$target" ;;
    curl) CURL_TARGET="$target" ;;
    md-runner-*)
      tool="${name#md-runner-}"
      case "$tool" in
        vllm-omni-bench) key="vllmOmniBench" ;;
        *) key="$tool" ;;
      esac
      RUNNER_LINES+=("    ${key}: ${target}")
      ;;
    *)
      echo "警告: 未识别的镜像 name=${name}(来自 ${src}),不会出现在 values 片段里,已按原样推送" >&2
      ;;
  esac
done

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo
  echo "==> [dry-run] 不会执行 docker load / docker tag / docker push"
else
  echo
  echo "==> docker load -i ${ARCHIVE}"
  docker load -i "$ARCHIVE"

  echo "==> 重打标签并推送"
  for i in "${!SRC_REFS[@]}"; do
    echo "==> docker tag ${SRC_REFS[$i]} ${TARGET_REFS[$i]}"
    docker tag "${SRC_REFS[$i]}" "${TARGET_REFS[$i]}"
    echo "==> docker push ${TARGET_REFS[$i]}"
    docker push "${TARGET_REFS[$i]}"
  done
fi

echo
echo "==> 以下 values 覆盖片段可直接保存为文件,'helm install -f <file>' 使用"
echo "---8<--- values-offline.yaml ---8<---"
if [[ -n "$APP_TARGET" ]]; then
  cat <<EOF
image:
  registry: ${REGISTRY}
  repository: ${PROJECT}/modeldoctor
  tag: ${APP_TAG}
EOF
fi
if [[ ${#RUNNER_LINES[@]} -gt 0 ]]; then
  echo "benchmarks:"
  echo "  runnerImages:"
  for line in "${RUNNER_LINES[@]}"; do
    echo "$line"
  done
fi
if [[ -n "$MINIO_TARGET" || -n "$MC_TARGET" ]]; then
  echo "storage:"
  echo "  minio:"
  [[ -n "$MINIO_TARGET" ]] && echo "    image: ${MINIO_TARGET}"
  [[ -n "$MC_TARGET" ]] && echo "    mcImage: ${MC_TARGET}"
fi
if [[ -n "$POSTGRES_TARGET" ]]; then
  echo "database:"
  echo "  postgres:"
  echo "    image: ${POSTGRES_TARGET}"
fi
if [[ -n "$CURL_TARGET" ]]; then
  echo "test:"
  echo "  image: ${CURL_TARGET}"
fi
echo "---8<--------------------------------8<---"
