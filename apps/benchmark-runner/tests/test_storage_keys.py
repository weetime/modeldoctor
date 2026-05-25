from runner.storage_keys import file_key, keys_for


def test_keys_for_basic():
    k = keys_for("run-abc")
    assert k.meta == "run-abc/meta.json"
    assert k.result == "run-abc/result.json"
    assert k.stdout == "run-abc/stdout.log"
    assert k.stderr == "run-abc/stderr.log"


def test_file_key():
    assert file_key("run-abc", "report.json") == "run-abc/files/report.json"
