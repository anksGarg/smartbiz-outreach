"""Test/live send gate for /followup/send and /custom-email/send, the
FOLLOWUP_ALLOW_LIVE_WITHOUT_ADDRESS override, and the guarantee that no
bracketed placeholder text ([BUSINESS MAILING ADDRESS], [GOOGLE REVIEW LINK])
ever reaches a rendered email."""

from __future__ import annotations

import itertools
import re

import pytest

import custom_email as ce
import followup_templates as ft
from conftest import TEST_RECIPIENT, followup_item

BRACKETED = re.compile(r"\[[A-Z][A-Z ]{3,}\]")

CUSTOM_PAYLOAD = {"subject": "Hello {{first_name}}", "body": "Hi {{first_name}}, a quick note."}


def _send(client, endpoint: str, items: list[dict]):
    if endpoint == "/followup/send":
        return client.post(endpoint, json={"items": items})
    return client.post(endpoint, json={**CUSTOM_PAYLOAD, "items": [{"name": i["name"], "email": i["email"]} for i in items]})


ENDPOINTS = ["/followup/send", "/custom-email/send"]


# ── test mode ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_test_mode_forces_test_recipient(client, smtp_env, endpoint):
    items = [followup_item("Jordan Testerson", "jordan@example.com"),
             followup_item("Casey Example", "casey@example.com")]
    resp = _send(client, endpoint, items)
    assert resp.status_code == 200
    assert resp.json()["mode"] == "test"
    sent = smtp_env.all_sent()
    assert len(sent) == 2
    for message, item in zip(sent, items):
        assert message["to"] == [TEST_RECIPIENT]
        assert message["msg"]["To"] == TEST_RECIPIENT
        assert message["subject"].startswith(f"[TEST] {item['name']} - ")
        assert message["text"].startswith(f"TEST MODE: this would have gone to {item['name']} <{item['email']}>")


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_test_mode_without_test_recipient_is_refused(client, smtp_env, monkeypatch, endpoint):
    monkeypatch.delenv("FOLLOWUP_TEST_RECIPIENT")
    resp = _send(client, endpoint, [followup_item()])
    assert resp.status_code == 500
    assert smtp_env.instances == []


def test_send_mode_endpoint_reports_test_recipient(client, smtp_env):
    assert client.get("/followup/send-mode").json() == {"mode": "test", "test_recipient": TEST_RECIPIENT}


# ── live mode gate ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_live_mode_refused_when_not_ready(client, smtp_env, monkeypatch, endpoint):
    monkeypatch.setenv("FOLLOWUP_SEND_MODE", "live")
    resp = _send(client, endpoint, [followup_item()])
    assert resp.status_code == 403
    assert smtp_env.instances == []


@pytest.mark.parametrize("endpoint", ENDPOINTS)
@pytest.mark.parametrize("value", ["true", "TRUE", "True", "  true  ", "\ttRuE\n"])
def test_override_accepts_only_true(client, smtp_env, monkeypatch, endpoint, value):
    monkeypatch.setenv("FOLLOWUP_SEND_MODE", "live")
    monkeypatch.setenv("FOLLOWUP_ALLOW_LIVE_WITHOUT_ADDRESS", value)
    resp = _send(client, endpoint, [followup_item()])
    assert resp.status_code == 200
    (message,) = smtp_env.all_sent()
    assert message["to"] == ["jordan@example.com"]
    assert "TEST" not in message["subject"]


@pytest.mark.parametrize("endpoint", ENDPOINTS)
@pytest.mark.parametrize("value", ["false", "False", "1", "yes", "on", "", "truee", "t"])
def test_override_other_values_stay_403(client, smtp_env, monkeypatch, endpoint, value):
    monkeypatch.setenv("FOLLOWUP_SEND_MODE", "live")
    monkeypatch.setenv("FOLLOWUP_ALLOW_LIVE_WITHOUT_ADDRESS", value)
    resp = _send(client, endpoint, [followup_item()])
    assert resp.status_code == 403
    assert smtp_env.instances == []


@pytest.mark.parametrize("value,expected", [
    ("true", True), (" TRUE ", True), ("false", False), ("1", False), ("yes", False), (None, False),
])
def test_live_override_enabled(monkeypatch, value, expected):
    if value is not None:
        monkeypatch.setenv("FOLLOWUP_ALLOW_LIVE_WITHOUT_ADDRESS", value)
    assert ft.live_override_enabled() is expected
    assert ft.is_live_ready() is expected
    assert ce.custom_email_live_ready() is expected


def test_live_ready_without_override_needs_footer_address_and_review_link(monkeypatch):
    monkeypatch.setattr(ft, "INCLUDE_COMPLIANCE_FOOTER", True)
    monkeypatch.setattr(ft, "MAILING_ADDRESS_PLACEHOLDER", "100 Example Ave, Portland, OR 97200")
    assert ce.custom_email_live_ready() is True
    assert ft.is_live_ready() is False  # follow-up also needs a real review link
    monkeypatch.setattr(ft, "FEEDBACK_URL", "https://example.com/review")
    assert ft.is_live_ready() is True
    monkeypatch.setattr(ft, "INCLUDE_COMPLIANCE_FOOTER", False)
    assert ft.is_live_ready() is False
    assert ce.custom_email_live_ready() is False


# ── no bracketed placeholder text, ever ──────────────────────────────────────

CONFIGS = [
    {},
    {"INCLUDE_COMPLIANCE_FOOTER": True},  # footer on but address still the placeholder
    {"FEEDBACK_URL": "https://example.com/review"},
    {"INCLUDE_COMPLIANCE_FOOTER": True, "MAILING_ADDRESS_PLACEHOLDER": "100 Example Ave, Portland, OR 97200",
     "FEEDBACK_URL": "https://example.com/review"},
]


def test_bracket_pattern_catches_the_shipped_placeholders():
    assert BRACKETED.search(ft._DEFAULT_MAILING_ADDRESS_PLACEHOLDER)
    assert BRACKETED.search(ft._DEFAULT_FEEDBACK_URL)


def _assert_no_brackets(rendered: dict) -> None:
    for key in ("subject", "body_text", "body_html"):
        assert not BRACKETED.search(rendered[key]), (key, BRACKETED.search(rendered[key]).group(0))


@pytest.mark.parametrize("config", CONFIGS)
def test_no_bracketed_placeholder_in_any_followup_render(monkeypatch, config):
    for key, value in config.items():
        monkeypatch.setattr(ft, key, value)
    combos = itertools.product(
        ["Jordan Testerson", "", "Sample Holdings LLC"], ft.CATEGORIES, ["", "2020-01-01"],
        [False, True], ["with_reroofing", "without_reroofing", None],
        [None, "Hi {{first_name}}, about your {{service_phrase}}. Google review please."],
    )
    for name, service, date, has_reroofing, template, custom_text in combos:
        rendered = ft.render_followup_email(
            name=name, last_service=service, last_service_date=date, has_reroofing=has_reroofing,
            reroofing_last_date=date, template=template, custom_text=custom_text,
        )
        _assert_no_brackets(rendered)


@pytest.mark.parametrize("config", CONFIGS)
def test_no_bracketed_placeholder_in_custom_email_render(monkeypatch, config):
    for key, value in config.items():
        monkeypatch.setattr(ft, key, value)
    for name in ["Jordan Testerson", "", "Sample Holdings LLC"]:
        _assert_no_brackets(ce.render_custom_email(CUSTOM_PAYLOAD["subject"], CUSTOM_PAYLOAD["body"], name))


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_no_bracketed_placeholder_in_live_override_send(client, live_env, endpoint):
    assert _send(client, endpoint, [followup_item()]).status_code == 200
    (message,) = live_env.all_sent()
    for part in ("subject", "text", "html"):
        assert not BRACKETED.search(message[part])
