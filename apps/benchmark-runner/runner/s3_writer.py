"""boto3 wrapper for runner→S3 writes.

Single-purpose: read S3_* from env, write objects under <runId>/...
Multipart handled automatically by upload_file for objects >5MB.
"""

from __future__ import annotations

import json
import os

import boto3
from botocore.config import Config


class S3Writer:
    @classmethod
    def from_env(cls) -> S3Writer:
        region = os.environ.get("S3_REGION", "us-east-1")
        # MinIO needs path-style; Aliyun OSS / AWS S3 need virtual-hosted.
        # Mirrors the API's S3_FORCE_PATH_STYLE (env.schema.ts). boto3 defaults
        # custom-endpoint clients to path-style, so OSS must be told "virtual".
        force_path = os.environ.get("S3_FORCE_PATH_STYLE", "true").lower() != "false"
        client = boto3.client(
            "s3",
            endpoint_url=os.environ["S3_ENDPOINT"],
            aws_access_key_id=os.environ["S3_ACCESS_KEY"],
            aws_secret_access_key=os.environ["S3_SECRET_KEY"],
            region_name=region,
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "path" if force_path else "virtual"},
                # OSS rejects the streaming "aws-chunked" content encoding that
                # botocore >=1.36 enables by default for flexible checksums.
                # WHEN_REQUIRED keeps checksums off unless an op mandates them;
                # harmless for MinIO.
                request_checksum_calculation="when_required",
                response_checksum_validation="when_required",
                retries={"max_attempts": 2, "mode": "standard"},
                connect_timeout=5,
                read_timeout=30,
            ),
        )
        return cls(client=client, bucket=os.environ["S3_BUCKET"])

    def __init__(self, *, client: object, bucket: str):
        self.client = client
        self.bucket = bucket

    def put_json(self, key: str, obj: object) -> None:
        body = json.dumps(obj).encode("utf-8")
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=body,
            ContentType="application/json",
        )

    def put_text(self, key: str, text: str) -> None:
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=text.encode("utf-8"),
            ContentType="text/plain; charset=utf-8",
        )

    def put_file(self, key: str, local_path: str) -> None:
        # upload_file handles multipart automatically for objects > 5MB
        self.client.upload_file(local_path, self.bucket, key)

    def list_keys(self, prefix: str) -> list[str]:
        keys: list[str] = []
        paginator = self.client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
            for obj in page.get("Contents", []):
                keys.append(obj["Key"])
        return keys

    def download_prefix(self, prefix: str, local_dir: str) -> int:
        count = 0
        for key in self.list_keys(prefix):
            rel = key[len(prefix) :] if key.startswith(prefix) else key
            if not rel:  # the prefix "dir" placeholder object, if any
                continue
            dest = os.path.join(local_dir, rel)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            self.client.download_file(self.bucket, key, dest)
            count += 1
        return count
