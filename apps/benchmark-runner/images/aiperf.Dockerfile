# syntax=docker/dockerfile:1.6

# Replacement for the deprecated genai-perf image. AIPerf is the
# NVIDIA-recommended successor (ai-dynamo/aiperf). Same posture as
# genai-perf: python-slim base, the perf tool is a pure-Python load
# generator (no GPU / CUDA needed).
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

ARG AIPERF_VERSION=0.7.0

RUN pip install --no-cache-dir \
        "aiperf==${AIPERF_VERSION}" \
        'requests>=2.31,<3'

WORKDIR /app
COPY runner runner

RUN useradd --create-home --shell /sbin/nologin runner \
    && chown -R runner:runner /app
USER runner

ENTRYPOINT ["python", "-m", "runner"]
