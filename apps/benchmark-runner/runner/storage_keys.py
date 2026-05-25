"""Object keys for the shared report storage layer.

Mirror of packages/contracts/src/benchmark.ts:reportStorageKeys.
Keep both in sync — runner writes, API reads, both must agree.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class StorageKeys:
    meta: str
    result: str
    stdout: str
    stderr: str


def keys_for(run_id: str) -> StorageKeys:
    return StorageKeys(
        meta=f"{run_id}/meta.json",
        result=f"{run_id}/result.json",
        stdout=f"{run_id}/stdout.log",
        stderr=f"{run_id}/stderr.log",
    )


def file_key(run_id: str, alias: str) -> str:
    return f"{run_id}/files/{alias}"
