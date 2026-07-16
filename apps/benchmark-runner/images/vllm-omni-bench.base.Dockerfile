# syntax=docker/dockerfile:1.6
# Base image for the vllm-omni-bench runner.
# vLLM-Omni 服务镜像自带 `vllm-omni bench` CLI(约 8 GiB —— bench 代码 import
# vllm 内部模块,瘦身需手工摘抄、跨版本脆弱,v1 直接复用,spec §2)。
# 生产集群应改从内网 SWR 引用同一 tag,避免跨网拉 8 GiB。
#
#   ./tools/build-base-images.sh vllm-omni-bench
#
# Then update vllm-omni-bench.Dockerfile's FROM line to the new tag.
#
# 预置 tokenizer:build-base-images.sh 在宿主机预下载(pattern 同 aiperf 的
# ShareGPT 预下载)到 .tokenizers/<org>/<name>/,COPY 进 /tokenizers。
# driver 的解析顺序:/tokenizers/<hfId> → HF_ENDPOINT → fail fast。
ARG VLLM_OMNI_VERSION=v0.24.0
FROM swr.cn-north-4.myhuaweicloud.com/inference-engines/vllm-omni:${VLLM_OMNI_VERSION}

# 已知 omni 模型的 tokenizer 文件(每个几十 MB,非权重):
#   Qwen/Qwen2.5-Omni-7B  Qwen/Qwen3-Omni-30B-A3B-Instruct
COPY .tokenizers/ /tokenizers/
