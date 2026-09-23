# ModelDoctor 离线交付包

给完全离网(air-gapped)的客户现场用的镜像交付流程:有网侧拉取镜像并打包,通过离线介质
(U 盘/移动硬盘/内网文件传输)带到现场,现场侧再把镜像重打标签推送到客户自己的仓库。

两个脚本对应两侧:

- `pull-and-save.sh` —— 有网侧,产出一个 tar + chart tgz + values 示例的交付目录。
- `load-and-push.sh` —— 现场侧,消费上面的 tar,推送到客户仓库并打印 values 覆盖片段。

`images.txt` 是两者共享的镜像清单(仅 `pull-and-save.sh` 读取),按 tier 分两段。

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

## 有网侧:拉取并打包

```bash
# 先登录能拉到应用/runner 镜像的仓库(把占位符换成真实账号密码,不要把真实凭据写进任何
# 提交到版本库的文件或聊天记录):
docker login -u <SWR_USERNAME> -p <SWR_PASSWORD> swr.cn-north-4.myhuaweicloud.com

./deploy/offline/pull-and-save.sh \
  --tier core \
  --app-tag v0.3.0 \
  --runner-tag v0.3.0 \
  --out ./dist/offline
```

产出目录内容:

- `modeldoctor-images-<tier>-<apptag>.tar` —— 该 tier 全部镜像的单个 `docker save` 归档。
- `modeldoctor-<chart版本>.tgz` —— `helm package` 打出的 chart 包(`--app-version` 已设成
  `--app-tag` 的值,`image.tag` 留空时会回退到这个 `appVersion`)。
- `values.yaml` / `values-external.yaml` / `values-4pd.yaml` —— chart 自带的三份 values
  示例,原样复制,现场按场景挑一份做起点。
- `manifest.txt` —— 每行一个镜像及其 digest(`RepoDigests`,拉不到时退化成本地 Image Id),
  用于核对现场收到的镜像跟有网侧拉取时是否为同一个内容。
- `checksums.sha256` —— 整个输出目录(除自身外)的 sha256,离线介质传输后先核对这个文件。

先用 `--dry-run` 确认清单再动手拉取(不产生任何文件、不发起任何网络请求以外的操作,只跑一次
`helm template` 做依赖镜像解析):

```bash
./deploy/offline/pull-and-save.sh --tier full --app-tag v0.3.0 --runner-tag v0.3.0 --dry-run
```

其余参数(`--out` 默认 `./dist/offline`、`--platform` 默认 `linux/amd64`)见 `--help`。

## 现场侧:导入并推送

```bash
# 先把有网侧的输出目录整体拷进现场机器,再登录客户自己的仓库:
docker login -u <REGISTRY_USERNAME> -p <REGISTRY_PASSWORD> registry.customer.local:5000

./deploy/offline/load-and-push.sh \
  --archive ./modeldoctor-images-core-v0.3.0.tar \
  --registry registry.customer.local:5000 \
  --project modeldoctor
```

脚本会:

1. 直接读 tar 自带的 `manifest.json`(docker save 的标准产物)得到镜像列表——现场只需要这一
   个 tar 文件,不需要额外携带 `images.txt` 或 chart 源码。
2. `docker load` 之后,把每个镜像重打标签成 `<registry>/<project>/<原仓库最后一段>:<原tag>`
   并推送(如 `swr.../md-runner-guidellm:v0.3.0` → `<registry>/modeldoctor/md-runner-guidellm:v0.3.0`)。
3. 在 stdout 打印一段 `values-offline.yaml` 片段(`image.*`、`benchmarks.runnerImages.*`、
   `storage.minio.image` / `mcImage`、`database.postgres.image`、`test.image`),把它保存
   成文件后可以直接:

   ```bash
   helm install modeldoctor deploy/charts/modeldoctor -f values-offline.yaml -f <前面复制来的场景 values>
   ```

先用 `--dry-run` 看重打标签计划和 values 片段,不落地任何 docker 操作:

```bash
./deploy/offline/load-and-push.sh --archive ./modeldoctor-images-core-v0.3.0.tar \
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

- [ ] `checksums.sha256` 在现场重新计算一遍,和有网侧产出的文件逐行比对。
- [ ] `manifest.txt` 里每个镜像的 digest,与 `docker load` 后 `docker image inspect
      --format '{{.RepoDigests}}'` 得到的结果一致(证明介质传输过程中内容没有被篡改/损坏)。
- [ ] `load-and-push.sh` 打印的 values 片段里,`image.tag` / `benchmarks.runnerImages.*` /
      `storage.minio.image` / `test.image` 等字段确实指向 `<registry>/<project>/...`,
      不是残留的 `swr.cn-north-4.myhuaweicloud.com/...` 或 `curlimages/curl`。
- [ ] 把该片段整段 `-f` 进 `helm install`/`helm upgrade` 后再执行 `helm test`,确认
      `/api/health` 探测通过——这一步同时验证了 `test.image` 确实生效。
