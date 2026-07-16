# syntax=docker/dockerfile:1.6
# vllm-omni-bench runner — thin wrapper on the vllm-omni base image.
# Rebuild whenever runner/ changes; base 见 vllm-omni-bench.base.Dockerfile。
# To bump the base (new vllm-omni tag or changed baked tokenizers): run
# `./tools/build-base-images.sh vllm-omni-bench`, then update the tag below.
FROM ghcr.io/weetime/md-base-vllm-omni-bench:0.24.0

WORKDIR /app

# Runner deps BEFORE `COPY runner` so editing runner/ doesn't bust this layer
# and reinstall on every image rebuild. Mirrors aiperf.Dockerfile / tau3.Dockerfile.
RUN pip install --no-cache-dir --disable-pip-version-check 'requests>=2.31,<3' 'boto3>=1.34,<2'

COPY runner runner

ENTRYPOINT ["python", "-m", "runner"]

# 基础镜像以 root 跑 —— bench 是纯客户端,与其他 runner 镜像的 useradd 收敛留作后续;
# 若 base 镜像自带非 root 用户则跟随之。
