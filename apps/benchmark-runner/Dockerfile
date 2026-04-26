# syntax=docker/dockerfile:1.6

FROM python:3.11-slim AS deps

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Copy only what's needed for dependency resolution first; this layer
# is cached as long as pyproject.toml doesn't change.
COPY pyproject.toml ./
COPY runner/__init__.py runner/__init__.py

RUN pip install --upgrade pip && pip install .

# ---- runtime stage ----

FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Copy the entire site-packages from the deps stage. python:3.11-slim's
# stdlib is enough; we don't need build toolchain at runtime.
COPY --from=deps /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=deps /usr/local/bin /usr/local/bin

# Copy the project source. Tests are excluded by .dockerignore.
COPY runner runner

# Run as a non-root user. The home dir doesn't have to exist for python -m.
RUN useradd --create-home --shell /sbin/nologin runner
USER runner

ENTRYPOINT ["python", "-m", "runner"]
