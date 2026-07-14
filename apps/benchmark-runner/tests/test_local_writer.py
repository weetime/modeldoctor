"""Tests for the offline filesystem sink (runner.local_writer.LocalWriter).

Mirrors S3Writer's protocol against a mounted output directory so the
runner produces the identical <id>/... layout without an object store.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from runner.local_writer import LocalWriter


def test_from_env_creates_root(monkeypatch, tmp_path: Path) -> None:
    root = tmp_path / "out" / "nested"
    monkeypatch.setenv("MD_OUTPUT_DIR", str(root))
    writer = LocalWriter.from_env()
    assert writer.root == str(root)
    assert root.is_dir()


def test_from_env_raises_when_unset(monkeypatch) -> None:
    monkeypatch.delenv("MD_OUTPUT_DIR", raising=False)
    with pytest.raises(KeyError):
        LocalWriter.from_env()


def test_put_json_lands_at_key(tmp_path: Path) -> None:
    writer = LocalWriter(root=str(tmp_path))
    writer.put_json("r1/meta.json", {"toolVersion": "x"})
    landed = tmp_path / "r1" / "meta.json"
    assert json.loads(landed.read_text()) == {"toolVersion": "x"}


def test_put_text_lands_at_key(tmp_path: Path) -> None:
    writer = LocalWriter(root=str(tmp_path))
    writer.put_text("r1/stdout.log", "hello\nworld")
    assert (tmp_path / "r1" / "stdout.log").read_text() == "hello\nworld"


def test_put_file_copies_to_key(tmp_path: Path) -> None:
    src = tmp_path / "report.json"
    src.write_text('{"ok":true}')
    writer = LocalWriter(root=str(tmp_path / "sink"))
    writer.put_file("r1/files/report", str(src))
    assert (tmp_path / "sink" / "r1" / "files" / "report").read_text() == '{"ok":true}'


def test_put_creates_nested_parent_dirs(tmp_path: Path) -> None:
    writer = LocalWriter(root=str(tmp_path))
    writer.put_text("r1/checkpoint/deep/a/b.json", "{}")
    assert (tmp_path / "r1" / "checkpoint" / "deep" / "a" / "b.json").exists()


def test_list_keys_returns_root_relative_slash_keys(tmp_path: Path) -> None:
    writer = LocalWriter(root=str(tmp_path))
    writer.put_text("run1/checkpoint/a.json", "a")
    writer.put_text("run1/checkpoint/d/b.json", "b")
    writer.put_text("run1/result.json", "r")
    keys = writer.list_keys("run1/checkpoint/")
    assert sorted(keys) == ["run1/checkpoint/a.json", "run1/checkpoint/d/b.json"]


def test_list_keys_empty_prefix_returns_all(tmp_path: Path) -> None:
    writer = LocalWriter(root=str(tmp_path))
    writer.put_text("run1/a.json", "a")
    writer.put_text("run2/b.json", "b")
    assert sorted(writer.list_keys("")) == ["run1/a.json", "run2/b.json"]


def test_download_prefix_round_trips_into_local_dir(tmp_path: Path) -> None:
    writer = LocalWriter(root=str(tmp_path / "sink"))
    writer.put_text("run1/checkpoint/x_air/results.json", "R")
    writer.put_text("run1/checkpoint/top.json", "T")
    dest = tmp_path / "restore"
    n = writer.download_prefix("run1/checkpoint/", str(dest))
    assert n == 2
    assert (dest / "x_air" / "results.json").read_text() == "R"
    assert (dest / "top.json").read_text() == "T"


def test_download_prefix_empty_returns_zero(tmp_path: Path) -> None:
    writer = LocalWriter(root=str(tmp_path / "sink"))
    assert writer.download_prefix("nope/", str(tmp_path / "restore")) == 0


def test_put_leaves_no_tmp_sibling(tmp_path: Path) -> None:
    """Atomic write cleans up: no <key>.tmp remains after a successful put."""
    writer = LocalWriter(root=str(tmp_path))
    writer.put_json("r1/meta.json", {"a": 1})
    writer.put_text("r1/stdout.log", "x")
    src = tmp_path / "src.bin"
    src.write_text("y")
    writer.put_file("r1/files/f", str(src))
    leftovers = [p.name for p in (tmp_path / "r1").rglob("*.tmp")]
    assert leftovers == []


def test_put_rejects_parent_traversal_key(tmp_path: Path) -> None:
    writer = LocalWriter(root=str(tmp_path / "sink"))
    with pytest.raises(ValueError):
        writer.put_text("../escape.txt", "x")


def test_put_rejects_absolute_key(tmp_path: Path) -> None:
    writer = LocalWriter(root=str(tmp_path / "sink"))
    with pytest.raises(ValueError):
        writer.put_text("/etc/passwd", "x")


def test_put_rejects_embedded_traversal_segment(tmp_path: Path) -> None:
    writer = LocalWriter(root=str(tmp_path / "sink"))
    with pytest.raises(ValueError):
        writer.put_file("r1/../../x", str(tmp_path))
