from unittest.mock import MagicMock

from runner.main import _CheckpointUploader, _upload_checkpoint_once


def test_upload_checkpoint_walks_dir(tmp_path):
    d = tmp_path / "data" / "simulations" / "run1_air"
    d.mkdir(parents=True)
    (d / "results.json").write_text("{}")
    s3 = MagicMock()
    _upload_checkpoint_once(s3, "run1", str(tmp_path / "data" / "simulations"))
    # uploaded under run1/checkpoint/run1_air/results.json
    key = s3.put_file.call_args[0][0]
    assert key == "run1/checkpoint/run1_air/results.json"


def test_uploader_thread_uploads_then_stops(tmp_path):
    (tmp_path / "f.json").write_text("{}")
    s3 = MagicMock()
    up = _CheckpointUploader(s3, "run1", str(tmp_path), interval=0.05)
    up.start()
    import time

    time.sleep(0.12)
    up.stop()
    up.join(timeout=1)
    assert s3.put_file.call_count >= 1
