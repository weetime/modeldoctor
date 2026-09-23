#!/usr/bin/env bash
# 离线交付包 · 有网侧:按 tier 拉取 ModelDoctor 所需镜像、docker save 成单个 tar,
# 连同 helm package 出的 chart tgz、values 示例、现场侧脚本 load-and-push.sh 以及
# 现场侧说明(field-README.md 复制成 README.md)一起放进输出目录,供离线介质
# (U 盘/移动硬盘/内网文件传输)带到现场。
#
# 输出目录必须是自描述的:现场机器上没有这个 git 仓库,任何"跑
# deploy/offline/load-and-push.sh"或"helm install deploy/charts/modeldoctor"的指引
# 在那边都是不存在的路径。因此现场要用到的东西一律复制进 --out,现场文档里的命令
# 也一律相对交付目录书写(./load-and-push.sh、./modeldoctor-<版本>.tgz)。
#
# 依赖镜像(Postgres / MinIO / mc / helm-test 用的 curl)不在 images.txt 里写死具体
# tag —— chart 的 values.yaml(database.postgres.image / storage.minio.image /
# storage.minio.mcImage / test.image)才是这些版本的唯一权威来源。本脚本用
# `helm template --show-only <component 模板>` 精确渲染出每个依赖组件自己的
# Pod/StatefulSet/Job 模板,从渲染结果里摘取 image 字段,而不是对 values.yaml
# 做字符串抓取或 yq 路径查询:这样即便某个字段的取值逻辑将来从字面量换成 helper
# 函数/coalesce 表达式发生改动,脚本拿到的都还是"chart 实际会渲染出哪个镜像"这个
# 唯一事实。若 chart 模板结构变化导致解析不出 image 字段,脚本会直接报错退出,
# 不会静默产出一个镜像缺失的坏 tar。
#
# 重要: 解析依赖镜像时,本脚本固定在打包机传入的 --values/--set 之后追加
# `--set database.bundled=true --set storage.bundled=true`,不管操作者用什么
# values 跑这个脚本。原因有两条:
#   1. 离线包本来就该带上依赖镜像——目标集群完全可能启用内置 Postgres/MinIO,即使
#      打包机本地用来验证配置的 values 文件是"外接数据库/外接存储"那一份(比如
#      values-external.yaml)。
#   2. 更根本的是:database.bundled=false / storage.bundled=false 时,chart 的
#      _helpers.tpl 会在缺 database.external.url/storage.external.endpoint 等
#      字段时主动 `fail`——而 `helm template --show-only <任意模板>` 依然会先
#      渲染整个 chart 求值再过滤输出,任何模板的 `fail` 都会让整条命令以非零退出码
#      中止,报错信息还完全跟目标依赖镜像无关。用一份"外接 DB + 外接存储"的真实
#      values 文件跑 `--tier core` 会直接触发这个问题,而不是本脚本要处理的边界情况。
#      固定 pin 住 bundled=true 让依赖解析这条只读渲染路径永远走"内置依赖"分支,
#      绕开这些 fail——不影响 `helm package` 打包出的 chart tgz 本身(那是整份
#      chart 原样打包,不带任何 --set)。
# 这个 pin 只覆盖 database.bundled / storage.bundled 这两个字段本身,不会吃掉用户
# 用 --values/--set 传的其它任何覆盖(比如下面反漂移自检用的
# --set storage.minio.image=...)。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHART_DIR="$(cd "${SCRIPT_DIR}/../charts/modeldoctor" && pwd)"
IMAGES_FILE="${SCRIPT_DIR}/images.txt"

TIER="core"
APP_TAG=""
RUNNER_TAG=""
OUT="./dist/offline"
PLATFORM="linux/amd64"
DRY_RUN=0
HELM_VALUES_ARGS=()
HELM_SET_ARGS=()

# 依赖镜像解析结果,默认空——只有 images.txt 里出现对应占位符时才会被填充,
# `set -u` 下必须先有默认值,否则未用到的占位符替换会在展开阶段就报 unbound variable。
POSTGRES_IMAGE=""
MINIO_IMAGE=""
MC_IMAGE=""
CURL_IMAGE=""

usage() {
  cat <<'USAGE'
用法: deploy/offline/pull-and-save.sh [选项]

按 tier 从 deploy/offline/images.txt 拉取镜像,docker save 成单个 tar,并把
chart tgz + values 示例一起放进输出目录,生成 manifest.txt 与 checksums.sha256。

选项:
  --tier <core|full>     默认 core。full 是 core 的超集(全量交付包),不是增量。
  --app-tag <tag>        必填(清单里 __APP_TAG__ 的替换值,应用镜像 tag)
  --runner-tag <tag>     必填(清单里 __RUNNER_TAG__ 的替换值,压测 runner 镜像 tag)
  --out <dir>            输出目录,默认 ./dist/offline
  --platform <platform>  docker pull --platform,默认 linux/amd64
                         (客户仓库不支持多架构 manifest list 时,这个默认值已经
                         规避了该问题——见 deploy/offline/README.md)
  --images <file>        覆盖默认清单文件,默认 deploy/offline/images.txt
  --chart-dir <dir>      覆盖默认 chart 目录,默认 deploy/charts/modeldoctor
  --values <file>        透传给内部 `helm template -f <file>`,可重复;可以传打包机
                         用来验证配置的场景 values(如 values-external.yaml)——依赖
                         镜像解析固定按 database.bundled=true / storage.bundled=true
                         处理,会忽略该文件里这两个字段的值(原因见 README),也可以
                         用来做反漂移自检(改别的字段,确认解析结果联动)
  --set <key=val>        透传给内部 `helm template --set <key=val>`,可重复,用途同上
                         (对 database.bundled/storage.bundled 同样不生效)
  --dry-run              只打印将要拉取/生成的内容,不执行 docker/helm 任何有副作用的操作
  -h, --help             显示此帮助

前置条件: docker(需已 `docker login` 私有仓库拉取应用/runner 镜像)、helm。
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tier)
      [[ $# -ge 2 ]] || { echo "错误: --tier 需要一个值" >&2; usage; exit 1; }
      TIER="$2"; shift 2 ;;
    --app-tag)
      [[ $# -ge 2 ]] || { echo "错误: --app-tag 需要一个值" >&2; usage; exit 1; }
      APP_TAG="$2"; shift 2 ;;
    --runner-tag)
      [[ $# -ge 2 ]] || { echo "错误: --runner-tag 需要一个值" >&2; usage; exit 1; }
      RUNNER_TAG="$2"; shift 2 ;;
    --out)
      [[ $# -ge 2 ]] || { echo "错误: --out 需要一个值" >&2; usage; exit 1; }
      OUT="$2"; shift 2 ;;
    --platform)
      [[ $# -ge 2 ]] || { echo "错误: --platform 需要一个值" >&2; usage; exit 1; }
      PLATFORM="$2"; shift 2 ;;
    --images)
      [[ $# -ge 2 ]] || { echo "错误: --images 需要一个值" >&2; usage; exit 1; }
      IMAGES_FILE="$2"; shift 2 ;;
    --chart-dir)
      [[ $# -ge 2 ]] || { echo "错误: --chart-dir 需要一个值" >&2; usage; exit 1; }
      CHART_DIR="$2"; shift 2 ;;
    --values)
      [[ $# -ge 2 ]] || { echo "错误: --values 需要一个值" >&2; usage; exit 1; }
      HELM_VALUES_ARGS+=(-f "$2"); shift 2 ;;
    --set)
      [[ $# -ge 2 ]] || { echo "错误: --set 需要一个值" >&2; usage; exit 1; }
      HELM_SET_ARGS+=(--set "$2"); shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; usage; exit 1 ;;
  esac
done

case "$TIER" in
  core|full) ;;
  *) echo "错误: --tier 必须是 core 或 full,收到: ${TIER}" >&2; exit 1 ;;
esac

[[ -f "$IMAGES_FILE" ]] || { echo "错误: 清单文件不存在: ${IMAGES_FILE}" >&2; exit 1; }
[[ -d "$CHART_DIR" ]] || { echo "错误: chart 目录不存在: ${CHART_DIR}" >&2; exit 1; }
# 交付目录里要复制的现场侧文件,缺一份就意味着现场拿到的包不自描述 —— 在拉几 GB 镜像
# 之前就失败,而不是打完包才发现少东西。
for required in "$SCRIPT_DIR/load-and-push.sh" "$SCRIPT_DIR/field-README.md"; do
  [[ -f "$required" ]] || { echo "错误: 交付包必备文件不存在: ${required}" >&2; exit 1; }
done
for required_values in "$CHART_DIR/values.yaml" "$CHART_DIR/values-external.yaml"; do
  [[ -f "$required_values" ]] || { echo "错误: 交付包必备 values 示例不存在: ${required_values}" >&2; exit 1; }
done

# ---- 1. 按 tier 过滤清单 ----------------------------------------------------
FILTERED_IMAGES=()
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" == \#* ]] && continue
  line_tier="${line%% *}"
  image_ref="${line#* }"
  case "$TIER" in
    core) [[ "$line_tier" == "core" ]] || continue ;;
    full) [[ "$line_tier" == "core" || "$line_tier" == "full" ]] || continue ;;
  esac
  FILTERED_IMAGES+=("$image_ref")
done < "$IMAGES_FILE"

[[ ${#FILTERED_IMAGES[@]} -gt 0 ]] || { echo "错误: tier=${TIER} 在 ${IMAGES_FILE} 里没有匹配到任何镜像" >&2; exit 1; }

# ---- 2. 探测清单实际用到哪些占位符,按需解析(测试用最小清单可以跳过 helm) ----
NEED_APP_TAG=0; NEED_RUNNER_TAG=0
NEED_POSTGRES=0; NEED_MINIO=0; NEED_MC=0; NEED_CURL=0
for image_ref in "${FILTERED_IMAGES[@]}"; do
  case "$image_ref" in *__APP_TAG__*) NEED_APP_TAG=1 ;; esac
  case "$image_ref" in *__RUNNER_TAG__*) NEED_RUNNER_TAG=1 ;; esac
  case "$image_ref" in *__POSTGRES_IMAGE__*) NEED_POSTGRES=1 ;; esac
  case "$image_ref" in *__MINIO_IMAGE__*) NEED_MINIO=1 ;; esac
  case "$image_ref" in *__MC_IMAGE__*) NEED_MC=1 ;; esac
  case "$image_ref" in *__CURL_IMAGE__*) NEED_CURL=1 ;; esac
done

if [[ "$NEED_APP_TAG" -eq 1 && -z "$APP_TAG" ]]; then
  echo "错误: 清单包含 __APP_TAG__ 占位符,必须提供 --app-tag" >&2; exit 1
fi
if [[ "$NEED_RUNNER_TAG" -eq 1 && -z "$RUNNER_TAG" ]]; then
  echo "错误: 清单包含 __RUNNER_TAG__ 占位符,必须提供 --runner-tag" >&2; exit 1
fi

# 从 chart 渲染结果里精确摘取某个依赖组件的 image 字段。
# $1 = 相对 chart 根的模板路径($2 = 报错信息里用的人类可读标签)。
# 注意: database.bundled=true / storage.bundled=true 这两个 --set 固定放在用户
# 传入的 --values/--set 之后——helm 后面的 --set/-f 覆盖前面的,这样不管操作者的
# values 文件把 bundled 设成什么,依赖镜像解析永远走"内置依赖"分支(见文件头注释),
# 同时不影响用户对其它字段(如 storage.minio.image)的覆盖。
resolve_component_image() {
  local tpl="$1" label="$2" rendered image
  if ! rendered="$(helm template modeldoctor-offline "$CHART_DIR" \
      "${HELM_VALUES_ARGS[@]+"${HELM_VALUES_ARGS[@]}"}" \
      "${HELM_SET_ARGS[@]+"${HELM_SET_ARGS[@]}"}" \
      --set database.bundled=true \
      --set storage.bundled=true \
      --show-only "$tpl" 2>&1)"; then
    echo "错误: helm template 渲染 ${label}(${tpl})失败,输出:" >&2
    printf '%s\n' "$rendered" >&2
    exit 1
  fi
  image="$(printf '%s\n' "$rendered" | grep -m1 -E '^[[:space:]]*image:' \
    | sed -E 's/^[[:space:]]*image:[[:space:]]*//' | tr -d "\"'")"
  if [[ -z "$image" ]]; then
    echo "错误: 未能从 ${tpl} 解析出 ${label} 镜像——chart 模板可能已变化,请检查该文件" >&2
    exit 1
  fi
  printf '%s' "$image"
}

if [[ "$NEED_POSTGRES" -eq 1 ]]; then
  echo "==> 从 chart 解析 postgres 依赖镜像(templates/deps/postgres/statefulset.yaml)"
  POSTGRES_IMAGE="$(resolve_component_image "templates/deps/postgres/statefulset.yaml" "postgres")"
fi
if [[ "$NEED_MINIO" -eq 1 ]]; then
  echo "==> 从 chart 解析 minio 依赖镜像(templates/deps/minio/statefulset.yaml)"
  MINIO_IMAGE="$(resolve_component_image "templates/deps/minio/statefulset.yaml" "minio")"
fi
if [[ "$NEED_MC" -eq 1 ]]; then
  echo "==> 从 chart 解析 minio mc 依赖镜像(templates/jobs/bucket-init.yaml)"
  MC_IMAGE="$(resolve_component_image "templates/jobs/bucket-init.yaml" "minio mc")"
fi
if [[ "$NEED_CURL" -eq 1 ]]; then
  echo "==> 从 chart 解析 helm-test curl 镜像(templates/tests/test-health.yaml)"
  CURL_IMAGE="$(resolve_component_image "templates/tests/test-health.yaml" "helm-test curl")"
fi

# ---- 3. 占位符替换,得到最终镜像清单 ----------------------------------------
RESOLVED_IMAGES=()
for image_ref in "${FILTERED_IMAGES[@]}"; do
  image_ref="${image_ref//__APP_TAG__/$APP_TAG}"
  image_ref="${image_ref//__RUNNER_TAG__/$RUNNER_TAG}"
  image_ref="${image_ref//__POSTGRES_IMAGE__/$POSTGRES_IMAGE}"
  image_ref="${image_ref//__MINIO_IMAGE__/$MINIO_IMAGE}"
  image_ref="${image_ref//__MC_IMAGE__/$MC_IMAGE}"
  image_ref="${image_ref//__CURL_IMAGE__/$CURL_IMAGE}"
  RESOLVED_IMAGES+=("$image_ref")
done

echo "==> tier=${TIER} 解析出的镜像清单(共 ${#RESOLVED_IMAGES[@]} 个):"
for image_ref in "${RESOLVED_IMAGES[@]}"; do
  echo "    ${image_ref}"
done

TAR_NAME="modeldoctor-images-${TIER}${APP_TAG:+-${APP_TAG}}.tar"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo
  echo "==> [dry-run] 不会执行 docker pull / docker save / helm package,以上即最终镜像清单"
  echo "==> [dry-run] platform=${PLATFORM}  out=${OUT}"
  echo "==> [dry-run] 将生成的交付目录内容:"
  echo "        ${OUT}/${TAR_NAME}"
  echo "        ${OUT}/modeldoctor-<chart版本>.tgz      (helm package,--app-version=${APP_TAG:-<未提供>})"
  echo "        ${OUT}/load-and-push.sh                 (现场侧脚本,从 ${SCRIPT_DIR} 复制)"
  echo "        ${OUT}/README.md                        (现场侧说明,来自 ${SCRIPT_DIR}/field-README.md)"
  echo "        ${OUT}/values.yaml"
  echo "        ${OUT}/values-external.yaml             (内部示例 values-4pd.yaml 不外发)"
  echo "        ${OUT}/manifest.txt"
  echo "        ${OUT}/checksums.sha256"
  exit 0
fi

# ---- 4. 真正拉取 + 打包 ------------------------------------------------------
mkdir -p "$OUT"

echo "==> 拉取镜像(--platform ${PLATFORM})"
for image_ref in "${RESOLVED_IMAGES[@]}"; do
  echo "==> docker pull --platform ${PLATFORM} ${image_ref}"
  docker pull --platform "$PLATFORM" "$image_ref"
done

TAR_PATH="${OUT}/${TAR_NAME}"
echo "==> docker save -o ${TAR_PATH}"
docker save -o "$TAR_PATH" "${RESOLVED_IMAGES[@]}"

echo "==> helm package chart -> ${OUT}"
PACKAGE_ARGS=(--destination "$OUT")
# --app-version 传的是带 v 的应用镜像 tag(如 v1.2.3),不是去掉 v 的 chart version。
# appVersion 是 chart 在 image.tag 留空时的回退值,必须逐字符等于仓库里真实存在的
# 镜像 tag —— 这与 .github/workflows/release.yml 里 Chart.yaml 的改写规则是同一个约定。
[[ -n "$APP_TAG" ]] && PACKAGE_ARGS+=(--app-version "$APP_TAG")
helm package "$CHART_DIR" "${PACKAGE_ARGS[@]}"

# 交付目录必须是自描述的:现场机器上没有这个仓库,任何"跑 deploy/offline/xxx.sh"或
# "helm install deploy/charts/modeldoctor"的指引在那边都是死路径。所以现场要用到的
# 脚本和文档都得躺在这个目录里。
echo "==> 复制现场侧脚本 load-and-push.sh"
cp "$SCRIPT_DIR/load-and-push.sh" "$OUT/"
chmod +x "$OUT/load-and-push.sh"

echo "==> 复制现场侧说明(field-README.md -> README.md)"
cp "$SCRIPT_DIR/field-README.md" "$OUT/README.md"

# 只发 values.yaml 与 values-external.yaml。values-4pd.yaml 是本团队自用集群的示例,
# 里面是内网地址/集群内 Service 名等内部信息,不应该随交付包发给每一个客户。
# 这里显式逐个列出而不是 values-*.yaml 通配 —— 将来新增内部示例时默认不外发,
# 需要外发的必须主动加到这个列表里。
echo "==> 复制 values 示例(values.yaml + values-external.yaml;内部示例 values-4pd.yaml 不外发)"
cp "$CHART_DIR/values.yaml" "$CHART_DIR/values-external.yaml" "$OUT/"

echo "==> 生成 manifest.txt(镜像列表 + digest)"
MANIFEST_PATH="${OUT}/manifest.txt"
: > "$MANIFEST_PATH"
for image_ref in "${RESOLVED_IMAGES[@]}"; do
  digest="$(docker image inspect "$image_ref" \
    --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{else}}{{.Id}}{{end}}' 2>/dev/null || echo unknown)"
  printf '%s\t%s\n' "$image_ref" "$digest" >> "$MANIFEST_PATH"
done

echo "==> 生成 checksums.sha256"
(
  cd "$OUT"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -- * > checksums.sha256.tmp
  else
    shasum -a 256 -- * > checksums.sha256.tmp
  fi
  mv checksums.sha256.tmp checksums.sha256
)

echo
echo "==> 完成。输出目录内容:"
ls -la "$OUT"
