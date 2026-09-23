#!/usr/bin/env bash
# 凭据形态扫描 —— 在代码库文本中查找"长得像凭据"的字符串形态,供 release 流水线
# (T11)与离线交付脚本(T13)复用。这是形态扫描,不是密钥吊销或密钥库集成:命中
# 只代表"值得人工确认",不代表一定是真实凭据;未命中也不能替代密钥轮换/密钥库审计。
# 本脚本本身不包含任何真实凭据样本,只有正则形态描述。
set -euo pipefail

usage() {
  cat <<'USAGE'
用法: tools/check-no-secrets.sh [目录或文件 ...]

扫描给定路径(默认当前目录)下的文本文件,查找疑似凭据的字符串形态:
  1. SWR 风格 access key —— 20 位连续大写字母/数字,且所在行文本中出现 "swr"
     (大小写不敏感,例如变量名/注释里提到 SWR 仓库)
  2. 64 位十六进制字符串 —— 常见 secret key / access key secret 的长度。排除
     两类已知的良性来源:行内标注了 "sha256"(镜像 digest、依赖锁文件 hash、
     checksums 文件——这才是仓库里 64 位十六进制串的绝大多数合法来源),以及
     单一字符重复 64 次的占位值(如测试用例里的全 0 hash)
  3. `docker login ... -p <字面量密码>` —— `-p` 后直接跟一个不是变量引用/占位符
     (不以 $ 或 < 开头,如 $VAR、${{ secrets.X }}、<SWR_PASSWORD>)的明文口令
  4. 云厂商 access key 前缀 —— AKIA(AWS)、LTAI(阿里云),后接 12 位以上
     大写字母/数字,总长 16 位以上

默认排除 .git/、node_modules/、dist/、.superpowers/ 目录,以及 *.tsbuildinfo
构建缓存文件与本脚本自身(用法说明里就会出现 "docker login"/"-p" 字样,
否则会被规则 3 误判)。可重复传入路径覆盖默认扫描范围,排除规则始终生效。

退出码:
  0  未发现命中
  1  发现命中(命中详情打印到 stdout,按规则分组)
  2  用法错误
USAGE
}

TARGETS=()
for arg in "$@"; do
  case "$arg" in
    -h|--help) usage; exit 0 ;;
    -*) echo "错误: 未知选项: $arg" >&2; usage; exit 2 ;;
    *) TARGETS+=("$arg") ;;
  esac
done
[[ ${#TARGETS[@]} -eq 0 ]] && TARGETS=(".")

for t in "${TARGETS[@]}"; do
  [[ -e "$t" ]] || { echo "错误: 路径不存在: $t" >&2; exit 2; }
done

EXCLUDE_DIRS=(".git" "node_modules" "dist" ".superpowers")
# check-no-secrets.sh 排除自身: 本文件的用法说明/规则注释里就写着
# "docker login" 与 "-p" 这两个词(用来描述第 3 条规则本身),会被第 3 条规则
# 误判成命中——排除自身是通用做法(shellcheck/eslint 等扫描器也排除自身配置)。
EXCLUDE_FILES=("*.tsbuildinfo" "check-no-secrets.sh")
GREP_EXCLUDES=()
for d in "${EXCLUDE_DIRS[@]}"; do
  GREP_EXCLUDES+=(--exclude-dir="$d")
done
for f in "${EXCLUDE_FILES[@]}"; do
  GREP_EXCLUDES+=(--exclude="$f")
done

TOTAL_HITS=0

report() {
  local label="$1" matches="$2"
  [[ -z "$matches" ]] && return 0
  echo "==> 命中: ${label}"
  printf '%s\n' "$matches"
  local n
  n="$(printf '%s\n' "$matches" | grep -c . || true)"
  TOTAL_HITS=$((TOTAL_HITS + n))
}

# 判断一个字符串是否是"单一字符重复"的占位值(如全 0、全 f)。
# 用字符串替换而非正则反向引用——反向引用在部分 shell/正则实现下不可靠
# (例如 macOS 自带 bash 3.2 的 [[ =~ ]] 不支持 \1)。
is_degenerate_repeat() {
  local token="$1" first="${1:0:1}"
  local stripped="${token//$first/}"
  [[ -z "$stripped" ]]
}

# 1. SWR 风格 access key:先找 20 位连续大写字母/数字,再过滤所在行含 "swr" 的。
swr_raw="$(grep -rInE "${GREP_EXCLUDES[@]}" '[A-Z0-9]{20}' "${TARGETS[@]}" 2>/dev/null || true)"
swr_matches="$(printf '%s' "$swr_raw" | grep -iE 'swr' || true)"
report "SWR 风格 access key(20 位大写字母/数字,行内含 swr)" "$swr_matches"

# 2. 64 位十六进制字符串,排除 sha256 标注行与单字符重复占位值。
hex_raw="$(grep -rInE "${GREP_EXCLUDES[@]}" '\b[0-9a-fA-F]{64}\b' "${TARGETS[@]}" 2>/dev/null || true)"
hex_matches=""
if [[ -n "$hex_raw" ]]; then
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    printf '%s' "$line" | grep -qiE 'sha256' && continue
    token="$(printf '%s' "$line" | grep -oE '[0-9a-fA-F]{64}' | head -1)"
    [[ -n "$token" ]] && is_degenerate_repeat "$token" && continue
    hex_matches+="${line}"$'\n'
  done <<< "$hex_raw"
  hex_matches="${hex_matches%$'\n'}"
fi
report "64 位十六进制字符串" "$hex_matches"

# 3. docker login 明文密码(-p 后不是 $ 开头的变量引用,也不是 < 开头的文档占位符)
dockerlogin_matches="$(grep -rInE "${GREP_EXCLUDES[@]}" 'docker login[^$]*-p[[:space:]]+[^$<[:space:]-][^[:space:]]*' "${TARGETS[@]}" 2>/dev/null || true)"
report "docker login 明文密码(-p 字面量,非 \$VAR/<占位符> 引用)" "$dockerlogin_matches"

# 4. 云厂商 access key 前缀(AKIA / LTAI + 12 位以上大写字母数字,总长 16+)
cloudkey_matches="$(grep -rInE "${GREP_EXCLUDES[@]}" '\b(AKIA|LTAI)[A-Z0-9]{12,}\b' "${TARGETS[@]}" 2>/dev/null || true)"
report "云厂商 access key 前缀(AKIA/LTAI)" "$cloudkey_matches"

echo
if [[ "$TOTAL_HITS" -gt 0 ]]; then
  echo "==> 共 ${TOTAL_HITS} 条命中,请人工确认后再放行(命中不等于真实凭据,但需要确认)。"
  exit 1
fi
echo "==> 0 条命中"
exit 0
