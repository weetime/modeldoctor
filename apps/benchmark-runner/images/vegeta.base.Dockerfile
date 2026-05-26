# syntax=docker/dockerfile:1.6
# Base image for the vegeta runner.
# Contains python:3.11-slim + pinned vegeta static binary — NO runner scripts.
# Rebuild and push only when bumping VEGETA_VERSION; tag matches that version.
#
#   ./tools/build-base-images.sh vegeta
#
# The binary is pre-downloaded by build-base-images.sh on the host to avoid
# TLS failures inside the Docker Desktop for Mac builder (GitHub → curl error 35).
# Then update vegeta.Dockerfile's FROM line to the new tag.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

ARG VEGETA_VERSION=12.13.0
ARG TARGETARCH
COPY images/.vegeta-binaries/vegeta_linux_${TARGETARCH} /usr/local/bin/vegeta
RUN chmod 0755 /usr/local/bin/vegeta && vegeta --version
