# syntax=docker/dockerfile:1.6
# Base image for the vllm-omni-bench runner.
# 瘦客户端(~150MB),NOT the 20GiB vllm-omni serving image: 压全模态端点的语音
# 输出指标(TTFA/RTF)是客户端从流式响应直接算的,只需 httpx + stdlib wave。
# 无框架、无 CUDA/torch、无 tokenizer —— ModelDoctor 是测试平台,压很多模型,
# 不可能把模型相关的东西烤进镜像。
#
#   ./tools/build-base-images.sh vllm-omni-bench
#
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# omni_driver 唯一的第三方依赖:httpx(async 流式 HTTP)。stdlib 提供
# asyncio/wave/base64/json/statistics。
RUN pip install --no-cache-dir --disable-pip-version-check 'httpx>=0.27,<1'
