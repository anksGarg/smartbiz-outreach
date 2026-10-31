"""Custom Email: placeholders, validation, rendering, and /custom-email/generate
with a fake Anthropic client (no network)."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

import followup_templates as ft
import main

# ── placeholders and render ──────────────────────────────────────────────────

def test_render_substitutes_placeholders(client):
    resp = client.post("/custom-email/render", json={
        "subject": "For {{ First_Name }}", "body": "Hi {{first_name}},\n\nThis is for {{FULL_NAME}}.",
        "name": "riley   sample",
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["subject"] == "For Riley"
    assert body["body_text"].startswith("Hi Riley,\n\nThis is for riley sample.")
    assert body["warnings"] == []


def test_render_uses_there_for_business_name_with_warning(client):
    body = client.post("/custom-email/render", json={
        "subject": "Hello", "body": "Hi {{first_name}}", "name": "Sample Holdings LLC",
    }).json()
    assert body["body_text"].startswith("Hi there")
    assert any("there" in w for w in body["warnings"])


@pytest.mark.parametrize("token", ["{{last_name}}", "{{year}}", "{{service}}"])
def test_render_reports_unknown_placeholder_as_warning(client, token):
    # Follow-up-only tokens like {{year}} are unknown in Custom Email.
    body = client.post("/custom-email/render", json={"subject": "Hi", "body": f"Hi {token}", "name": "Jo Ex"}).json()
    assert any(token in w for w in body["warnings"])
    assert token in body["body_text"]  # left as-is, never guessed


@pytest.mark.parametrize("token", ["{{last_name}}", "{{year}}"])
@pytest.mark.parametrize("field", ["subject", "body"])
def test_send_rejects_unknown_placeholder(client, smtp_env, token, field):
    payload = {"subject": "Hello", "body": "Hi {{first_name}}", "items": [{"name": "Jo Ex", "email": "jo@example.com"}]}
    payload[field] = f"Text {token}"
    resp = client.post("/custom-email/send", json=payload)
    assert resp.status_code == 400
    assert token in resp.json()["detail"]
    assert smtp_env.instances == []


@pytest.mark.parametrize("field", ["subject", "body"])
def test_send_rejects_empty_subject_or_body(client, smtp_env, field):
    payload = {"subject": "Hello", "body": "Hi", "items": [{"name": "Jo Ex", "email": "jo@example.com"}]}
    payload[field] = "   "
    assert client.post("/custom-email/send", json=payload).status_code == 400
    assert smtp_env.instances == []


@pytest.mark.parametrize("endpoint", ["/custom-email/render", "/custom-email/send"])
@pytest.mark.parametrize("field,limit", [("subject", 150), ("body", 5000)])
def test_length_caps(client, smtp_env, endpoint, field, limit):
    payload = {"subject": "Hello", "body": "Hi", "name": "Jo Ex", "items": [{"name": "Jo Ex", "email": "jo@example.com"}]}
    assert client.post(endpoint, json={**payload, field: "x" * limit}).status_code == 200
    assert client.post(endpoint, json={**payload, field: "x" * (limit + 1)}).status_code == 400


def test_render_escapes_html_and_strips_crlf(client):
    body = client.post("/custom-email/render", json={
        "subject": "Hi\r\nBcc: attacker@example.com", "body": "<script>alert(1)</script>", "name": "Jo <b>Ex</b>",
    }).json()
    assert "<script" not in body["body_html"].lower()
    assert "&lt;script&gt;" in body["body_html"]
    assert "\r" not in body["subject"] and "\n" not in body["subject"]


def test_render_always_appends_signature_and_opt_out(client):
    body = client.post("/custom-email/render", json={"subject": "Hi", "body": "Short.", "name": "Jo Ex"}).json()
    assert body["body_text"] == f"Short.\n\n{ft.signature_text()}\n\n{ft.OPT_OUT_LINE}"
    assert ft.signature_html() in body["body_html"]
    assert body["body_html"].endswith(ft.compliance_footer_html())


def test_render_output_equals_send_output(client, live_env):
    payload = {"subject": "For {{first_name}}", "body": "Hi {{first_name}},\n\nA note for {{full_name}}."}
    client.post("/custom-email/send", json={**payload, "items": [{"name": "Riley Sample", "email": "riley@example.com"}]})
    (message,) = live_env.all_sent()
    preview = client.post("/custom-email/render", json={**payload, "name": "Riley Sample"}).json()
    assert message["subject"] == preview["subject"]
    assert message["text"].rstrip("\n") == preview["body_text"]
    assert message["html"].rstrip("\n") == preview["body_html"]


# ── /custom-email/generate ───────────────────────────────────────────────────

class FakeAnthropic:
    calls: list[dict] = []
    reply_text = '{"subject": "Fall gutter check", "body": "Hi {{first_name}},\\n\\nWant a gutter check?"}'
    error: Exception | None = None

    def __init__(self, api_key=None, **kwargs):
        self.api_key = api_key
        self.messages = SimpleNamespace(create=self._create)

    def _create(self, **kwargs):
        FakeAnthropic.calls.append(kwargs)
        if FakeAnthropic.error is not None:
            raise FakeAnthropic.error
        return SimpleNamespace(content=[SimpleNamespace(text=FakeAnthropic.reply_text)])


@pytest.fixture
def fake_anthropic(monkeypatch):
    FakeAnthropic.calls = []
    FakeAnthropic.error = None
    FakeAnthropic.reply_text = '{"subject": "Fall gutter check", "body": "Hi {{first_name}},\\n\\nWant a gutter check?"}'
    monkeypatch.setattr(main.anthropic, "Anthropic", FakeAnthropic)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key-not-real")
    return FakeAnthropic


def test_generate_success(client, fake_anthropic):
    resp = client.post("/custom-email/generate", json={"instruction": "Offer a fall gutter check", "tone": "friendly"})
    assert resp.status_code == 200
    assert resp.json() == {"subject": "Fall gutter check", "body": "Hi {{first_name}},\n\nWant a gutter check?",
                           "warnings": []}
    (call,) = fake_anthropic.calls
    assert call["messages"] == [{"role": "user", "content": "Offer a fall gutter check"}]
    assert "friendly" in call["system"]


def test_generate_parses_fenced_reply_and_warns_on_unknown_placeholder(client, fake_anthropic):
    fake_anthropic.reply_text = '```json\n{"subject": "Hi\\r\\nthere", "body": "Hi {{last_name}}"}\n```'
    body = client.post("/custom-email/generate", json={"instruction": "Say hi"}).json()
    assert body["subject"] == "Hithere"
    assert body["warnings"] == ["Unknown placeholder(s): {{last_name}}"]


def test_generate_not_configured(client, monkeypatch):
    resp = client.post("/custom-email/generate", json={"instruction": "Say hi"})
    assert resp.status_code == 500
    assert resp.json()["detail"] == "AI drafting is not configured."


def test_generate_cooldown_429(client, fake_anthropic):
    assert client.post("/custom-email/generate", json={"instruction": "Say hi"}).status_code == 200
    second = client.post("/custom-email/generate", json={"instruction": "Say hi again"})
    assert second.status_code == 429
    assert len(fake_anthropic.calls) == 1


@pytest.mark.parametrize("instruction", ["", "   ", "x" * 1001])
def test_generate_rejects_bad_instruction(client, fake_anthropic, instruction):
    assert client.post("/custom-email/generate", json={"instruction": instruction}).status_code == 400
    assert fake_anthropic.calls == []


@pytest.mark.parametrize("reply", ["not json at all", '{"subject": 1, "body": "x"}'])
def test_generate_bad_model_reply_is_generic_502(client, fake_anthropic, capsys, reply):
    fake_anthropic.reply_text = reply
    resp = client.post("/custom-email/generate", json={"instruction": "Secret plan for jo@example.com"})
    assert resp.status_code == 502
    assert resp.json()["detail"] == "Could not generate a draft. Please try again."
    logs = capsys.readouterr().out
    assert "Secret plan" not in logs and "@" not in logs


def test_generate_provider_error_is_generic_502(client, fake_anthropic, capsys):
    fake_anthropic.error = RuntimeError("provider said something about jo@example.com")
    resp = client.post("/custom-email/generate", json={"instruction": "Say hi"})
    assert resp.status_code == 502
    logs = capsys.readouterr().out
    assert "RuntimeError" in logs
    assert "provider said" not in logs and "@" not in logs


def test_generate_logs_never_include_instruction(client, fake_anthropic, capsys):
    client.post("/custom-email/generate", json={"instruction": "Private owner instruction text"})
    logs = capsys.readouterr().out
    assert "generated draft" in logs
    assert "Private owner instruction" not in logs
