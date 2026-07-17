# syntax=docker/dockerfile:1.6
# vllm-omni-bench runner — thin async client (~150MB), NOT the vllm-omni serving
# image. Rebuild whenever runner/ changes; base 见 vllm-omni-bench.base.Dockerfile。
FROM ghcr.io/weetime/md-base-vllm-omni-bench:0.24.0

WORKDIR /app

# Runner deps BEFORE `COPY runner` so editing runner/ doesn't bust this layer.
# boto3 = wrapper S3 sink; requests = defensive transitive; httpx is in the base.
RUN pip install --no-cache-dir --disable-pip-version-check 'requests>=2.31,<3' 'boto3>=1.34,<2'

COPY runner runner

RUN useradd --create-home --shell /sbin/nologin runner \
    && chown -R runner:runner /app
USER runner

ENTRYPOINT ["python", "-m", "runner"]
