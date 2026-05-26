# syntax=docker/dockerfile:1.6
# aiperf runner — our thin wrapper on top of the stable base image.
# Rebuild whenever runner/ changes; the base (aiperf + ShareGPT dataset) is
# pulled from the registry cache.
# To bump aiperf: run `./tools/build-base-images.sh aiperf`, then update the
# tag below and AIPERF_VERSION in build-base-images.sh.
FROM ghcr.io/weetime/md-base-aiperf:0.7.0

COPY runner runner

# Pinned to match pyproject.toml's requests>=2.31,<3 declaration.
RUN pip install --no-cache-dir 'requests>=2.31,<3' 'boto3>=1.34,<2'

RUN useradd --create-home --shell /sbin/nologin runner \
    && chown -R runner:runner /app
USER runner

ENTRYPOINT ["python", "-m", "runner"]
