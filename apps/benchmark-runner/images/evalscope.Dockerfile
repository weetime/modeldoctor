# syntax=docker/dockerfile:1.6

# Modelscope evalscope perf load generator. Bakes LongAlpaca-12k +
# HC3-Chinese open_qa.jsonl at build time so the image runs on
# air-gapped clusters. Image ~1.75 GB.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MODELSCOPE_CACHE=/opt/evalscope-datasets

ARG EVALSCOPE_VERSION=1.7.0

RUN pip install --no-cache-dir \
        "evalscope==${EVALSCOPE_VERSION}" \
        "modelscope==1.36.3" \
        'requests>=2.31,<3'

# Bake LongAlpaca-12k. modelscope download's positional `repo_id` defaults
# to model lookup; LongAlpaca-12k is a dataset, so `--dataset` is required.
RUN modelscope download \
        --dataset AI-ModelScope/LongAlpaca-12k \
        --local_dir /opt/evalscope-datasets/longalpaca

# Bake openqa (HC3-Chinese) for the inf-evalscope-short template + any
# openqa-driven manual runs. Only open_qa.jsonl is needed.
RUN python -c "from modelscope import dataset_snapshot_download; \
    import shutil, os; \
    p = dataset_snapshot_download('AI-ModelScope/HC3-Chinese', allow_patterns=['open_qa.jsonl']); \
    os.makedirs('/opt/evalscope-datasets/openqa', exist_ok=True); \
    shutil.copy(os.path.join(p, 'open_qa.jsonl'), '/opt/evalscope-datasets/openqa/open_qa.jsonl')"

WORKDIR /app
COPY runner runner

RUN useradd --create-home --shell /sbin/nologin runner \
    && chown -R runner:runner /app /opt/evalscope-datasets
USER runner

ENTRYPOINT ["python", "-m", "runner"]
