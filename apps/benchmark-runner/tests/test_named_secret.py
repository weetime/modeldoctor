import json
import subprocess

from runner.main import _inject_named_secrets, _redacted


def test_replaces_named_secret_tokens(monkeypatch):
    monkeypatch.setenv("AGENT_KEY", "sk-agent")
    monkeypatch.setenv("USER_KEY", "sk-user")
    argv = [
        "/bin/sh",
        "-c",
        'tau2 ... {"api_key":"__MD_SECRET_AGENT_KEY__"} ... {"api_key":"__MD_SECRET_USER_KEY__"}',
    ]
    out = _inject_named_secrets(argv)
    assert "sk-agent" in out[2] and "sk-user" in out[2]
    assert "__MD_SECRET_" not in out[2]


def test_missing_env_leaves_token(monkeypatch):
    monkeypatch.delenv("NOPE", raising=False)
    argv = ["echo", "__MD_SECRET_NOPE__"]
    assert _inject_named_secrets(argv) == ["echo", "__MD_SECRET_NOPE__"]


def test_named_secret_escaped_value_round_trips_through_shell_and_json(monkeypatch):
    """A secret containing both a shell-breaking `'` and JSON-breaking `"`/`\\`
    must survive the escaping in _inject_named_secrets when the sentinel sits
    inside a JSON string wrapped in single-quoted shell (tau2's context):
    real /bin/sh quote-parsing + json.loads must recover the exact original
    secret, not a mangled or truncated one.
    """
    secret = 'a\'b"c\\d'
    monkeypatch.setenv("MD_AGENT_KEY", secret)
    argv = [
        "/bin/sh",
        "-c",
        """printf '%s' '{"api_key":"__MD_SECRET_MD_AGENT_KEY__"}'""",
    ]
    out = _inject_named_secrets(argv)
    assert "__MD_SECRET_" not in out[2]

    proc = subprocess.run(out, capture_output=True, text=True, check=True)
    recovered = json.loads(proc.stdout)["api_key"]
    assert recovered == secret


def test_redacted_masks_escaped_api_key_without_leaking_tail():
    """After _inject_named_secrets escapes a `"`/`\\`-bearing secret, the
    embedded `\\"` must not be mistaken for the JSON closing quote by
    _redacted — the whole value (including anything after the escaped
    quote) must be masked, not just the prefix up to it."""
    secret = 'a\'b"c\\d'
    argv = ["/bin/sh", "-c", "x"]
    # Emulate what _inject_named_secrets would have produced for `secret`.
    escaped = secret.replace("\\", "\\\\").replace('"', '\\"').replace("'", "'\\''")
    argv[2] = f'tau2 --agent-llm-args \'{{"api_key":"{escaped}"}}\''
    out = _redacted(argv)
    joined = " ".join(out)
    assert "***" in joined
    # Nothing after the escaped quote (e.g. the trailing "c\\d") leaks.
    assert "c\\\\d" not in joined
    assert secret not in joined


def test_redacted_masks_bare_api_key_json():
    """Asserts _redacted masks bare api_key JSON substrings in argv tokens."""
    argv = [
        "/bin/sh",
        "-c",
        (
            'tau2 run --agent-llm-args '
            '{"api_base":"http://a/v1","api_key":"sk-agent"} '
            '--user-llm-args {"api_key":"sk-user"}'
        ),
    ]
    out = _redacted(argv)
    joined = " ".join(out)
    assert "sk-agent" not in joined
    assert "sk-user" not in joined
    assert "***" in joined
