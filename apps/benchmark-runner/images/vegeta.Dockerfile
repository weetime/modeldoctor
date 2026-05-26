# syntax=docker/dockerfile:1.6
# vegeta runner — our thin wrapper on top of the stable base image.
# Rebuild whenever runner/ changes; the base is pulled from the registry cache.
# To bump vegeta: run `./tools/build-base-images.sh vegeta`, then update the
# tag below and update VEGETA_VERSION in build-base-images.sh.
FROM ghcr.io/weetime/md-base-vegeta:12.13.0

WORKDIR /app
COPY runner runner

# Pinned to match pyproject.toml's requests>=2.31,<3 declaration.
RUN pip install --no-cache-dir 'requests>=2.31,<3'

RUN useradd --create-home --shell /sbin/nologin runner \
    && chown -R runner:runner /app
USER runner

# vegeta is invoked via /bin/sh -c '<pipeline>' argv produced by
# packages/tool-adapters/src/vegeta/runtime.ts.
ENTRYPOINT ["python", "-m", "runner"]
