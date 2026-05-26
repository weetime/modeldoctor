# syntax=docker/dockerfile:1.6
# evalscope runner — our thin wrapper on top of the stable base image.
# Rebuild whenever runner/ changes; the base (evalscope + datasets) is pulled
# from the registry cache.
# To bump evalscope: run `./tools/build-base-images.sh evalscope`, then update
# the tag below and EVALSCOPE_VERSION in build-base-images.sh.
FROM ghcr.io/weetime/md-base-evalscope:1.7.0

WORKDIR /app
COPY runner runner

# Pinned to match pyproject.toml's requests>=2.31,<3 declaration.
RUN pip install --no-cache-dir 'requests>=2.31,<3' 'boto3>=1.34,<2'

RUN useradd --create-home --shell /sbin/nologin runner \
    && chown -R runner:runner /app /opt/evalscope-datasets
USER runner

ENTRYPOINT ["python", "-m", "runner"]
