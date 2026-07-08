import json
from unittest.mock import MagicMock

import boto3
import pytest
from botocore.exceptions import ClientError
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
    stdout_resp = s3_client.get_object(Bucket="test-bucket", Key="r1/stdout.log")
    stdout = stdout_resp["Body"].read().decode()
    assert stdout == "hello\nworld"
    report_resp = s3_client.get_object(Bucket="test-bucket", Key="r1/files/report.json")
    report = report_resp["Body"].read().decode()
    assert report == '{"ok":true}'


@mock_aws
def test_writer_raises_when_bucket_missing(s3_env):
    # No bucket created — put should raise
    s3_client = boto3.client("s3", region_name="us-east-1")
    writer = S3Writer(client=s3_client, bucket="test-bucket")
    with pytest.raises(ClientError):
        writer.put_json("r1/meta.json", {})


def test_list_keys_paginates():
    client = MagicMock()
    client.get_paginator.return_value.paginate.return_value = [
        {"Contents": [{"Key": "run1/checkpoint/a.json"}]},
        {"Contents": [{"Key": "run1/checkpoint/d/b.json"}]},
    ]
    w = S3Writer(client=client, bucket="b")
    assert w.list_keys("run1/checkpoint/") == ["run1/checkpoint/a.json", "run1/checkpoint/d/b.json"]


def test_download_prefix_rebuilds_subdirs(tmp_path):
    client = MagicMock()
    client.get_paginator.return_value.paginate.return_value = [
        {"Contents": [{"Key": "run1/checkpoint/x_air/results.json"}]},
    ]
    w = S3Writer(client=client, bucket="b")
    n = w.download_prefix("run1/checkpoint/", str(tmp_path))
    assert n == 1
    client.download_file.assert_called_once()
    # local path = tmp_path/x_air/results.json
    args = client.download_file.call_args[0]
    assert args[0] == "b" and args[1] == "run1/checkpoint/x_air/results.json"
    assert args[2].endswith("x_air/results.json")


def test_download_prefix_empty_returns_zero():
    client = MagicMock()
    client.get_paginator.return_value.paginate.return_value = [{}]  # no Contents
    assert S3Writer(client=client, bucket="b").download_prefix("nope/", "/tmp") == 0
