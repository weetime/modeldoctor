# ModelDoctor 离线交付包 —— 打包侧说明

> **这份文件是给打包工程师看的**(有网环境、手上有这个 git 仓库),所以命令都以仓库根目录
> 为起点(`./deploy/offline/...`)。
>
> 现场工程师看的是另一份:`field-README.md`——`pull-and-save.sh` 会把它复制进交付目录、
> 改名为 `README.md`。现场机器上没有这个仓库,那份文档里的命令一律相对交付目录书写
> (`./load-and-push.sh`、`helm install ... ./modeldoctor-<版本>.tgz`)。
> **改动交付流程时两份都要同步**,尤其是任何带路径的命令。

给完全离网(air-gapped)的客户现场用的镜像交付流程:有网侧拉取镜像并打包,通过离线介质
(U 盘/移动硬盘/内网文件传输)带到现场,现场侧再把镜像重打标签推送到客户自己的仓库。

两个脚本对应两侧:

- `pull-and-save.sh` —— 有网侧,产出自描述的交付目录(镜像 tar + chart tgz + values 示例
  + `load-and-push.sh` + 现场侧 `README.md`)。
- `load-and-push.sh` —— 现场侧,消费上面的 tar,推送到客户仓库并打印 values 覆盖片段。
  它由 `pull-and-save.sh` 复制进交付目录,现场直接 `./load-and-push.sh` 运行。

`images.txt` 是镜像清单(仅 `pull-and-save.sh` 读取,不进交付包),按 tier 分两段。
`field-README.md` 是上面说的现场侧文档模板。

## 分层(tier)

- **core** —— 最小可用:应用镜像 + 内置依赖(Postgres、MinIO、mc、helm-test 用的 curl)
  + 性能压测主路径两个工具(guidellm、vegeta)。**磁盘占用约 2–3GB。**
- **full** —— `core` 的超集(不是增量),额外带上 evalscope、aiperf、tau3、
  vllm-omni-bench 四个 runner。这几个镜像体积很大——evalscope 基础镜像内置约 866MB
  数据集,aiperf 约 672MB——**磁盘占用约 15GB+**,现场带宽或介质容量紧张时优先只带 `core`,
  后续需要再单独跑一次 `--tier full` 补发。

## 依赖镜像版本从哪来(不要在这里问"要不要更新 images.txt")

`images.txt` 里 Postgres / MinIO / mc / curl 四个依赖镜像**只有占位符,没有具体 tag**:

```
core __POSTGRES_IMAGE__
core __MINIO_IMAGE__
core __MC_IMAGE__
core __CURL_IMAGE__
```

`pull-and-save.sh` 在运行时用 `helm template --show-only <组件模板>` 精确渲染出 chart 里
Postgres StatefulSet / MinIO StatefulSet / 建桶 Job / helm-test Pod 各自的模板,再从渲染
结果里摘取真实 `image:` 值——**chart 的 `deploy/charts/modeldoctor/values.yaml` 才是这四个
依赖镜像版本的唯一权威来源**,这份 README 和 `images.txt` 都不重复维护一份副本。原因很直接:
副本会在 chart 升级依赖版本(比如换一个 MinIO release)后悄悄漂移——离线包看起来还能生成,
实际打包出去的却是上一个版本的镜像,现场装上后版本对不齐但没有任何报错提示。

应用镜像和 runner 镜像不受此约束——它们的仓库路径固定写在 `images.txt` 里
(`swr.cn-north-4.myhuaweicloud.com/modeldoctor/...`),具体 tag 由 `--app-tag` /
`--runner-tag` 两个脚本参数在运行时替换,因为它们对应的是"这次要交付哪个版本"这个业务决策,
不是 chart 的默认值。

**有意为之的行为:依赖镜像解析永远按"内置依赖"处理。** `pull-and-save.sh` 内部渲染时固定
追加 `--set database.bundled=true --set storage.bundled=true`,不管你用 `--values`/`--set`
传的场景 values 里这两个字段是什么。两个原因:

1. 离线包本来就该带上 Postgres/MinIO 镜像——现场目标集群完全可能启用内置依赖,即使你打包
   时用来验证配置的 values 文件是"外接数据库/外接存储"那一份(比如 `values-external.yaml`,
   `database.bundled: false` / `storage.bundled: false`)。
2. 更根本的原因是:chart 在 `database.bundled=false` / `storage.bundled=false` 且没提供
   对应外接字段(`database.external.url`、`storage.external.endpoint` 等)时,会主动
   `fail` 掉整个渲染——而 `helm template --show-only <任意模板>` 依然要先对整份 chart
   求值才能过滤输出,这个 `fail` 会让命令直接以非零退出码中止,报错信息还完全跟你要解析的
   依赖镜像无关。用一份真实的"外接 DB + 外接存储"生产 values 跑 `--tier core` 会直接触发
   这个问题。固定 pin 住 `bundled=true` 让这条只读的镜像解析路径永远绕开这些 `fail`。

这个 pin 只覆盖 `database.bundled` / `storage.bundled` 这两个字段本身,`--values`/`--set`
里对其它任何字段的覆盖(比如 `storage.minio.image`)照常生效——不会被一起吃掉。也不影响
`helm package` 打出的 chart tgz 本身,那是整份 chart 原样打包,不带任何 `--set`。

## 有网侧:拉取并打包

### 两个 tag 参数怎么取(`--app-tag` 与 `--runner-tag` 规则不同,别填成同一个值)

- **`--app-tag`** = 这次要交付的应用镜像 tag,就是 release 用的那个 git tag 原样(**带 `v`**),
  例如 `v0.3.0`。`tools/build-app-image.sh --tag "$GITHUB_REF_NAME" --push` 推的就是它,
  chart 的 `appVersion` 也是它。
- **`--runner-tag`** = 压测 runner 镜像(`md-runner-*`)的 tag,它**不跟应用共用版本号**,
  而是 `apps/benchmark-runner/` 子树最近一次提交的短 SHA——这是
  `tools/build-runner-images.sh` 实际打出来的 tag,也是 `.github/workflows/release.yml`
  的 "Derive runner image tag" 步骤推导的值。填一个应用版本号(`v0.3.0`)进去,
  `docker pull` 会直接 404,因为仓库里根本不存在那个 tag。

  在仓库根目录执行下面这条命令取值:

  ```bash
  git log -1 --format=%h -- apps/benchmark-runner/
  ```

```bash
# 先登录能拉到应用/runner 镜像的仓库。用 --password-stdin,不要用 -p <明文>:
# 命令行参数会进 shell 历史和 ps 进程列表。(release 流水线用的也是 --password-stdin。)
printf '%s' '<SWR_PASSWORD>' | \
  docker login swr.cn-north-4.myhuaweicloud.com -u '<SWR_USERNAME>' --password-stdin

RUNNER_TAG="$(git log -1 --format=%h -- apps/benchmark-runner/)"

./deploy/offline/pull-and-save.sh \
  --tier core \
  --app-tag v0.3.0 \
  --runner-tag "$RUNNER_TAG" \
  --out ./dist/offline
```

产出目录内容(这是一个**自描述**的目录——现场只需要这个目录,不需要仓库):

- `modeldoctor-images-<tier>-<apptag>.tar` —— 该 tier 全部镜像的单个 `docker save` 归档。
- `modeldoctor-<chart版本>.tgz` —— `helm package` 打出的 chart 包(`--app-version` 已设成
  `--app-tag` 的值,`image.tag` 留空时会回退到这个 `appVersion`)。**现场的 `helm install`
  装的就是这个文件**,不是 `deploy/charts/modeldoctor` 那个仓库路径。
- `load-and-push.sh` —— 从 `deploy/offline/` 复制进来的现场侧脚本,现场直接
  `./load-and-push.sh` 运行。
- `README.md` —— 从 `deploy/offline/field-README.md` 复制并改名而来的现场侧说明,里面的
  命令全部相对交付目录书写。
- `values.yaml` / `values-external.yaml` —— chart 自带的两份 values 示例,现场按场景挑一份
  做起点。**`values-4pd.yaml` 是本团队自用集群的示例(含内网地址),有意不外发**;
  脚本里这三份是逐个列出的白名单,不是 `values-*.yaml` 通配——将来新增内部示例默认不外发。
  这个"不外发"是双重保证:上面这份散装文件白名单只管这里复制出来的三份 loose 文件;
  `modeldoctor-<chart版本>.tgz` 本身(即上一条)是否也带着 `values-4pd.yaml` 是另一回事,
  由 `deploy/charts/modeldoctor/.helmignore` 里的排除规则保证 `helm package` 不会把它打进
  tgz——两处任一处失守都会让内网地址外泄,改动前都要重新跑一遍校验清单里的
  `tar -tzf` 检查。
- `manifest.txt` —— 每行一个镜像及其 digest(有网侧 `docker pull` 时拿到的
  `RepoDigests`,没有仓库关联信息时退化成本地 Image Id),是"这次打包时到底拉的是哪个
  内容"的留档记录,供审计/排查用。**注意**:`docker load` 之后本地镜像不带任何仓库关联,
  `docker image inspect --format '{{.RepoDigests}}'` 必然是空——这不是介质损坏,是
  save/load 往返的正常行为,不能拿它去跟 manifest.txt 比对(见下面校验清单的说明)。
- `checksums.sha256` —— 整个输出目录(除自身外)的 sha256,是介质传输后真正有效的完整性
  校验:离线介质拷贝完先核对这个文件,逐行比对现场重新计算的结果。

先用 `--dry-run` 确认清单再动手拉取(不产生任何文件、不发起任何网络请求以外的操作,只跑一次
`helm template` 做依赖镜像解析;同时会列出将要生成的交付目录内容):

```bash
./deploy/offline/pull-and-save.sh --tier full --app-tag v0.3.0 \
  --runner-tag "$(git log -1 --format=%h -- apps/benchmark-runner/)" --dry-run
```

其余参数(`--out` 默认 `./dist/offline`、`--platform` 默认 `linux/amd64`)见 `--help`。

## 现场侧:导入并推送

> 完整的现场步骤在交付目录自带的 `README.md` 里(源文件是本目录的 `field-README.md`)。
> 这里只是给打包工程师一个概览,**不要**照抄下面的路径去现场执行——现场的工作目录是交付
> 目录本身,脚本是 `./load-and-push.sh`,chart 是 `./modeldoctor-<版本>.tgz`。

```bash
# 把有网侧的输出目录整体拷进现场机器,cd 进去,再登录客户自己的仓库:
printf '%s' '<REGISTRY_PASSWORD>' | \
  docker login registry.customer.local:5000 -u '<REGISTRY_USERNAME>' --password-stdin

./load-and-push.sh \
  --archive ./modeldoctor-images-core-v0.3.0.tar \
  --registry registry.customer.local:5000 \
  --project modeldoctor
```

脚本会:

1. 直接读 tar 自带的 `manifest.json`(docker save 的标准产物)得到镜像列表——镜像清单这件事
   上只需要这一个 tar,不需要额外携带 `images.txt` 或 chart 源码。
2. `docker load` 之后,把每个镜像重打标签成 `<registry>/<project>/<原仓库最后一段>:<原tag>`
   并推送(如 `swr.../md-runner-guidellm:<runner短SHA>` → `<registry>/modeldoctor/md-runner-guidellm:<runner短SHA>`)。
3. 在 stdout 打印一段 `values-offline.yaml` 片段(`image.*`、`benchmarks.runnerImages.*`、
   `storage.minio.image` / `mcImage`、`database.postgres.image`、`test.image`),把它保存
   成文件后可以直接:

   ```bash
   helm install modeldoctor ./modeldoctor-<chart版本>.tgz \
     --namespace modeldoctor --create-namespace \
     -f values-offline.yaml -f <同目录里的 values.yaml 或 values-external.yaml>
   ```

先用 `--dry-run` 看重打标签计划和 values 片段,不落地任何 docker 操作:

```bash
./load-and-push.sh --archive ./modeldoctor-images-core-v0.3.0.tar \
  --registry registry.customer.local:5000 --project modeldoctor --dry-run
```

### helm-test 用的 curl 镜像

`helm test`(`templates/tests/test-health.yaml`)用来打 `/api/health` 的
`curlimages/curl:8.11.1` 走的是 chart 的 `test.image` 字段(默认值就是
`curlimages/curl:8.11.1`),不是硬编码——离线包里它对应 `images.txt` 的
`__CURL_IMAGE__` 占位符,`pull-and-save.sh` 会把它跟其它依赖一起拉取/打包,
`load-and-push.sh` 也会把它重打标签、推送到客户仓库,并写进打印出来的 values 片段:

```yaml
test:
  image: <registry>/<project>/curl:8.11.1
```

现场装完后 `helm test` 拉的就是这份客户仓库里的副本,不需要额外配置 registry mirror 或
跳过测试——把 `load-and-push.sh` 打印的片段整段 `-f` 进 `helm install`/`helm upgrade` 即可,
不用手改这一行;如果只想单独设置这一项,也可以直接 `--set test.image=<registry>/<project>/curl:8.11.1`。

## 客户仓库不支持 manifest list 时怎么办

`pull-and-save.sh` 默认按单一架构(`--platform linux/amd64`)拉取——即便应用镜像和 runner
镜像在 SWR 上是用 `docker manifest` 合成的多架构 manifest list(见
`tools/build-app-image.sh` 的注释:SWR 本身也拒收 buildx 直接推送的 OCI image index),
`docker pull --platform` 会先解析这个 manifest list,只把目标架构那一份单架构镜像拉下来、
`docker save` 成普通单架构镜像。`load-and-push.sh` 侧的 `docker push` 因此也只是推送一个
普通单架构 tag,不会尝试合成或推送 manifest list。

也就是说:**这条离线交付链路从设计上就不依赖客户仓库支持 manifest list**——不需要额外
"退化"步骤,`--platform` 参数本身就是退化路径。如果现场是混合架构集群(部分节点
`arm64`),对每个架构分别跑一遍 `pull-and-save.sh --platform linux/arm64` +
`load-and-push.sh`,现场自己按节点架构选择镜像 tag(或另外用 `docker manifest create` 在
客户仓库内手动合成——这一步不在本交付包脚本覆盖范围内)。

## 校验清单(交接时对一遍)

> 这份清单同时也在交付目录的 `README.md`(源文件 `field-README.md`)第 6 节里——改一处
> 记得改另一处。

- [ ] `checksums.sha256` 在现场重新计算一遍(`sha256sum -c checksums.sha256` 或逐行用
      `shasum -a 256` 比对),这是介质传输后唯一有效、任何情况下都能跑的完整性校验——
      **不要**用 `docker load` 之后的 `docker image inspect --format '{{.RepoDigests}}'`
      去跟 `manifest.txt` 比对:`RepoDigests` 是镜像与仓库的关联信息,`load` 出来的镜像
      本地压根没有仓库关联,这个字段必然是空 `[]`,不管介质是否完好,拿它做校验只会
      得到一个永远"失败"的假信号。
- [ ] (可选,更强的身份校验)`load-and-push.sh` 推送完成后,对每个镜像跑
      `docker image inspect <registry>/<project>/<name>:<tag> --format '{{.RepoDigests}}'`——
      推送到仓库之后这个字段才会真正被填充,且内容寻址的 digest(`@sha256:...` 后半段)
      在镜像内容不变的前提下应该和 `manifest.txt` 里记录的一致。这一步依赖客户仓库
      按标准 Docker Registry v2 协议返回 manifest digest,不是所有仓库实现都完全一致,
      跳过也不影响交付——`checksums.sha256` 已经是充分的完整性保证。
- [ ] `load-and-push.sh` 打印的 values 片段里,`image.tag` / `benchmarks.runnerImages.*` /
      `storage.minio.image` / `test.image` 等字段确实指向 `<registry>/<project>/...`,
      不是残留的 `swr.cn-north-4.myhuaweicloud.com/...` 或 `curlimages/curl`。
- [ ] 把该片段整段 `-f` 进 `helm install`/`helm upgrade` 后再执行 `helm test`,确认
      `/api/health` 探测通过——这一步同时验证了 `test.image` 确实生效。
