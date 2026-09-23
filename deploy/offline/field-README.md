# ModelDoctor 离线交付包 —— 现场安装说明

> 这份文件由 `pull-and-save.sh` 原样复制进交付目录(在交付目录里它的文件名就是
> `README.md`)。它面向**现场工程师**:你手上只有这个目录,没有 ModelDoctor 的源码仓库,
> 所以下面所有命令都相对**当前目录**书写,不引用任何仓库路径。
>
> 打包侧(有网环境、有仓库)的说明是仓库里的 `deploy/offline/README.md`,不是这一份。

## 0. 这个目录里有什么

```
modeldoctor-images-<tier>-<apptag>.tar   该 tier 全部镜像的 docker save 归档
modeldoctor-<chart版本>.tgz              Helm chart 包 —— 现场就装这个文件
load-and-push.sh                         本目录自带的导入/推送脚本(就是下面要跑的那个)
README.md                                本文件
values.yaml                              chart 的默认值,作为参考/起点
values-external.yaml                     外接数据库 + 外接 S3 场景的 values 示例
manifest.txt                             每个镜像及其 digest,审计留档
checksums.sha256                         上述文件的 sha256,介质传输后的完整性校验
```

先确认一下实际文件名(tar 和 tgz 的名字里带版本号,下文用 `<...>` 占位):

```bash
ls -la
```

## 1. 先校验完整性

```bash
sha256sum -c checksums.sha256    # macOS 没有 sha256sum 时:shasum -a 256 -c checksums.sha256
```

`checksums.sha256` 是**唯一**在任何环境下都成立的完整性校验。不要用
`docker load` 之后的 `docker image inspect --format '{{.RepoDigests}}'` 去跟 `manifest.txt`
比对——`RepoDigests` 是镜像与仓库的关联信息,`load` 出来的本地镜像压根没有仓库关联,这个
字段必然是空 `[]`,不管介质是否完好,拿它做校验只会得到一个永远"失败"的假信号。

## 2. 登录客户自己的镜像仓库

```bash
# 用 --password-stdin,不要把口令写进命令行(会进 shell 历史和进程列表)
printf '%s' '<REGISTRY_PASSWORD>' | \
  docker login registry.customer.local:5000 -u '<REGISTRY_USERNAME>' --password-stdin
```

## 3. 导入镜像并推送到客户仓库

```bash
# 先 --dry-run 看重打标签计划和将要生成的 values 片段,不落地任何 docker 操作
./load-and-push.sh \
  --archive ./modeldoctor-images-core-<apptag>.tar \
  --registry registry.customer.local:5000 \
  --project modeldoctor \
  --dry-run

# 确认无误后去掉 --dry-run 真正执行
./load-and-push.sh \
  --archive ./modeldoctor-images-core-<apptag>.tar \
  --registry registry.customer.local:5000 \
  --project modeldoctor
```

脚本做三件事:

1. 直接读 tar 自带的 `manifest.json` 得到镜像列表——不需要额外的清单文件;
2. `docker load` 之后把每个镜像重打标签成 `<registry>/<project>/<原仓库最后一段>:<原tag>` 并推送;
3. 在 stdout 打印一段 `values-offline.yaml` 片段(`image.*`、`benchmarks.runnerImages.*`、
   `storage.minio.image` / `mcImage`、`database.postgres.image`、`test.image`)。

把第 3 步打印的片段(两条 `---8<---` 分隔线之间的内容)保存成文件:

```bash
# 也可以直接 ./load-and-push.sh ... | sed -n '/---8<--- values-offline.yaml/,/^---8<---/p' 之类的方式截取,
# 但最稳妥的还是人工复制粘贴后再通读一遍
vi values-offline.yaml
```

## 4. 安装 chart

**安装目标是本目录里的 `.tgz` 文件**,不是任何仓库路径:

```bash
helm install modeldoctor ./modeldoctor-<chart版本>.tgz \
  --namespace modeldoctor --create-namespace \
  -f values-offline.yaml \
  -f <values.yaml 或 values-external.yaml,按场景挑一份并按现场情况改过的> \
  --wait --timeout 15m
```

几点必读:

- `-f` 的顺序有意义,后面的覆盖前面的。`values-offline.yaml`(镜像地址)放前面,现场场景
  values 放后面。
- 前置条件:`helm` ≥ 3.8、Kubernetes ≥ 1.24、一个可用的默认 StorageClass(内置 Postgres/MinIO
  要申请 PVC)。
- 不需要设置 `image.tag`——chart 的 `appVersion` 就是应用镜像的 tag。但离线场景下
  `values-offline.yaml` 里本来就写了 `image.tag`,以它为准。
- 装完跑一次冒烟测试:

  ```bash
  helm test modeldoctor --namespace modeldoctor --logs
  ```

## 5. chart 自己的完整文档在 tgz 里

参数表、三种部署场景、升级回滚、**卸载(重要:卸载不会清空数据,重装的坑都在这一节)**、
备份恢复、排障,全部在 chart 包内的 README 里。解出来看:

```bash
tar -xzf modeldoctor-<chart版本>.tgz modeldoctor/README.md
less modeldoctor/README.md
```

## 6. 交接前对一遍

- [ ] `sha256sum -c checksums.sha256` 全部 OK。
- [ ] `load-and-push.sh` 打印的 values 片段里,`image.*` / `benchmarks.runnerImages.*` /
      `storage.minio.image` / `test.image` 确实指向 `<registry>/<project>/...`,不是残留的
      `swr.cn-north-4.myhuaweicloud.com/...` 或 `curlimages/curl`。
- [ ] `helm install` 之后 `kubectl -n <namespace> get pods` 全部 Running/Completed,没有
      `ImagePullBackOff`(有的话就是上一条没对齐)。
- [ ] `helm test` 通过——这一步同时验证了 `test.image` 确实指向客户仓库里的副本。
- [ ] (可选,更强的身份校验)推送完成后对每个镜像跑
      `docker image inspect <registry>/<project>/<name>:<tag> --format '{{.RepoDigests}}'`,
      与 `manifest.txt` 里记录的 digest 比对。推送到仓库之后这个字段才会被填充。
      这一步依赖客户仓库按标准 Docker Registry v2 协议返回 manifest digest,不是所有仓库
      实现都一致,跳过也不影响交付。
