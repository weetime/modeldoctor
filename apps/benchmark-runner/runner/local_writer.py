"""Filesystem sink for runner→local-dir writes (offline / air-gapped mode).

Same key→object protocol as S3Writer, but objects land under a mounted
directory (`MD_OUTPUT_DIR`) instead of an object store. The on-disk layout
is byte-for-byte the S3 layout (`<id>/meta.json`, `<id>/files/<alias>`,
`<id>/checkpoint/...`), so a caller with the mount can read results directly
— no S3 client, no MinIO.
"""

from __future__ import annotations

import json
import os
import shutil


def _key_to_relpath(key: str) -> str:
    """Map an S3-style ``a/b/c`` key to an OS-native relative path.

    Keys are always internal (``<id>/...``), but reject anything that could
    escape the sink root — absolute keys or ``..`` segments — so a bad key
    can never write outside `MD_OUTPUT_DIR`.
    """
    if key.startswith("/"):
        raise ValueError(f"absolute key not allowed: {key!r}")
    parts = key.split("/")
    if any(p == ".." for p in parts):
        raise ValueError(f"parent-traversal key not allowed: {key!r}")
    return os.path.join(*parts)


class LocalWriter:
    @classmethod
    def from_env(cls) -> LocalWriter:
        root = os.environ["MD_OUTPUT_DIR"]
        os.makedirs(root, exist_ok=True)
        return cls(root=root)

    def __init__(self, *, root: str):
        self.root = root

    def _dest(self, key: str) -> str:
        dest = os.path.join(self.root, _key_to_relpath(key))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        return dest

    def put_json(self, key: str, obj: object) -> None:
        with open(self._dest(key), "w", encoding="utf-8") as f:
            json.dump(obj, f)

    def put_text(self, key: str, text: str) -> None:
        with open(self._dest(key), "w", encoding="utf-8") as f:
            f.write(text)

    def put_file(self, key: str, local_path: str) -> None:
        shutil.copyfile(local_path, self._dest(key))

    def list_keys(self, prefix: str) -> list[str]:
        keys: list[str] = []
        for root, _dirs, files in os.walk(self.root):
            for name in files:
                full = os.path.join(root, name)
                rel = os.path.relpath(full, self.root)
                key = rel.replace(os.sep, "/")
                if key.startswith(prefix):
                    keys.append(key)
        return keys

    def download_prefix(self, prefix: str, local_dir: str) -> int:
        count = 0
        for key in self.list_keys(prefix):
            rel = key[len(prefix) :] if key.startswith(prefix) else key
            if not rel:
                continue
            dest = os.path.join(local_dir, *rel.split("/"))
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            shutil.copyfile(os.path.join(self.root, *key.split("/")), dest)
            count += 1
        return count
