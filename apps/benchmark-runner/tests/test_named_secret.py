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
