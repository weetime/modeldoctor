# syntax=docker/dockerfile:1.6
# aiperf runner — our thin wrapper on top of the stable base image.
# Rebuild whenever runner/ changes; the base (aiperf + ShareGPT dataset) is
# pulled from the registry cache.
# To bump aiperf: run `./tools/build-base-images.sh aiperf`, then update the
# tag below and AIPERF_VERSION in build-base-images.sh.
FROM ghcr.io/weetime/md-base-aiperf:0.10.0

WORKDIR /app

# Runner deps BEFORE `COPY runner` so editing runner/ doesn't bust this layer
# and reinstall on every image rebuild. boto3 = the wrapper's only declared
# dep (pyproject.toml); requests is pinned defensively for transitive importers.
RUN pip install --no-cache-dir --disable-pip-version-check 'requests>=2.31,<3' 'boto3>=1.34,<2'

COPY runner runner

RUN useradd --create-home --shell /sbin/nologin runner \
    && chown -R runner:runner /app
USER runner

ENTRYPOINT ["python", "-m", "runner"]
