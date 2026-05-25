import json

import boto3
import pytest
from moto import mock_aws

from runner.s3_writer import S3Writer


@pytest.fixture
def s3_env(monkeypatch):
    monkeypatch.setenv("S3_ENDPOINT", "http://localhost:9999")
    monkeypatch.setenv("S3_ACCESS_KEY", "test")
    monkeypatch.setenv("S3_SECRET_KEY", "test")
    monkeypatch.setenv("S3_BUCKET", "test-bucket")
    monkeypatch.setenv("S3_REGION", "us-east-1")


@mock_aws
def test_writer_puts_json_text_and_file(s3_env, tmp_path):
    # Use a moto-intercepted client (no custom endpoint_url) injected directly
    # so moto can intercept calls — from_env() would set endpoint_url which
    # bypasses moto's botocore shim.
    s3_client = boto3.client("s3", region_name="us-east-1")
    s3_client.create_bucket(Bucket="test-bucket")
    writer = S3Writer(client=s3_client, bucket="test-bucket")

    writer.put_json("r1/meta.json", {"toolVersion": "x"})
    writer.put_text("r1/stdout.log", "hello\nworld")
    local = tmp_path / "report.json"
    local.write_text('{"ok":true}')
    writer.put_file("r1/files/report.json", str(local))

    meta = json.loads(s3_client.get_object(Bucket="test-bucket", Key="r1/meta.json")["Body"].read())
    assert meta == {"toolVersion": "x"}
    stdout = s3_client.get_object(Bucket="test-bucket", Key="r1/stdout.log")["Body"].read().decode()
    assert stdout == "hello\nworld"
    report = s3_client.get_object(Bucket="test-bucket", Key="r1/files/report.json")["Body"].read().decode()
    assert report == '{"ok":true}'


@mock_aws
def test_writer_raises_when_bucket_missing(s3_env):
    # No bucket created — put should raise
    s3_client = boto3.client("s3", region_name="us-east-1")
    writer = S3Writer(client=s3_client, bucket="test-bucket")
    with pytest.raises(Exception):
        writer.put_json("r1/meta.json", {})
