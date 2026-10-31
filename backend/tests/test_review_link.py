"""The shipped Google review link (followup_templates.FEEDBACK_URL): linked in
HTML, appended in plain text, absent unless it's an https:// URL, and never a
factor in the opt-out/footer or the Custom Email output."""

from __future__ import annotations

import itertools
import re

import pytest

import custom_email as ce
import followup_templates as ft
from conftest import SHIPPED_FEEDBACK_URL, followup_item

REVIEW_URL = "https://g.page/r/CXk_0yKFsLBNEAI/review"
BRACKETED = re.compile(r"\[[A-Z][A-Z ]{3,}\]")
TEMPLATES = ["with_reroofing", "without_reroofing"]


def _draft(client, template, **extra):
    payload = {k: v for k, v in followup_item(template=template).items() if k != "email"}
    resp = client.post("/followup/draft", json={**payload, **extra})
    assert resp.status_code == 200
    return resp.json()


@pytest.fixture
def shipped_url(monkeypatch):
    monkeypatch.setattr(ft, "FEEDBACK_URL", SHIPPED_FEEDBACK_URL)


def test_shipped_value():
    assert SHIPPED_FEEDBACK_URL == REVIEW_URL
    assert SHIPPED_FEEDBACK_URL.startswith("https://")


# ── link present ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("template", TEMPLATES)
def test_link_in_html_and_url_in_text(client, shipped_url, template):
    body = _draft(client, template)
    assert body["body_html"].count(f'<a href="{REVIEW_URL}">Google review</a>.') == 1
    assert body["body_text"].count(f"please leave us a Google review. {REVIEW_URL}") == 1
    assert body["body_text"].count(REVIEW_URL) == 1


@pytest.mark.parametrize("template", TEMPLATES)
def test_no_bracketed_placeholder_anywhere(client, shipped_url, template):
    body = _draft(client, template)
    for key in ("subject", "body_text", "body_html"):
        assert not BRACKETED.search(body[key])


@pytest.mark.parametrize("template", TEMPLATES)
def test_link_in_sent_email(client, live_env, shipped_url, template):
    item = followup_item(template=template)
    assert client.post("/followup/send", json={"items": [item]}).status_code == 200
    (message,) = live_env.all_sent()
    assert f'<a href="{REVIEW_URL}">Google review</a>' in message["html"]
    assert f"Google review. {REVIEW_URL}" in message["text"]
    preview = _draft(client, template)
    assert message["html"].rstrip("\n") == preview["body_html"]


def test_custom_text_keeping_the_phrase_gets_the_link(client, shipped_url):
    body = _draft(client, "without_reroofing", custom_text="Hi {{first_name}}. A Google review would help!")
    assert f'<a href="{REVIEW_URL}">Google review</a> would help!' in body["body_html"]
    assert f"Google review {REVIEW_URL} would help!" in body["body_text"]


def test_custom_text_without_the_phrase_has_no_link(client, shipped_url):
    body = _draft(client, "without_reroofing", custom_text="Hi {{first_name}}. Thanks!")
    assert REVIEW_URL not in body["body_text"]
    assert REVIEW_URL not in body["body_html"]


# ── link absent unless https ─────────────────────────────────────────────────

@pytest.mark.parametrize("value", [
    "", "   ", ft._DEFAULT_FEEDBACK_URL, "http://g.page/r/CXk_0yKFsLBNEAI/review",
    "g.page/r/CXk_0yKFsLBNEAI/review", "javascript:alert(1)", " https://g.page/r/x/review",
])
@pytest.mark.parametrize("template", TEMPLATES)
def test_link_absent_when_not_https(client, monkeypatch, value, template):
    monkeypatch.setattr(ft, "FEEDBACK_URL", value)
    body = _draft(client, template)
    assert "Google review</a>" not in body["body_html"]
    assert body["body_text"].count("Google review.\n") == 1  # sentence ends, nothing appended
    if value.strip():
        assert value.strip() not in body["body_text"]
        assert value.strip() not in body["body_html"]
    for key in ("subject", "body_text", "body_html"):
        assert not BRACKETED.search(body[key])


# ── gates and footer unaffected ──────────────────────────────────────────────

URL_VALUES = [ft._DEFAULT_FEEDBACK_URL, REVIEW_URL, ""]


def test_shipped_config_is_still_not_live_ready(shipped_url):
    # Footer off + placeholder address: the link alone never opens live sending.
    assert ft.INCLUDE_COMPLIANCE_FOOTER is False
    assert ft.is_live_ready() is False
    assert ce.custom_email_live_ready() is False


def test_live_send_still_403_with_shipped_link(client, smtp_env, monkeypatch, shipped_url):
    monkeypatch.setenv("FOLLOWUP_SEND_MODE", "live")
    assert client.post("/followup/send", json={"items": [followup_item()]}).status_code == 403
    assert smtp_env.instances == []


@pytest.mark.parametrize("footer,address,override", itertools.product(
    [False, True], [ft._DEFAULT_MAILING_ADDRESS_PLACEHOLDER, "100 Example Ave, Portland, OR 97200"], [None, "true"],
))
def test_footer_and_custom_email_gate_independent_of_link(monkeypatch, footer, address, override):
    monkeypatch.setattr(ft, "INCLUDE_COMPLIANCE_FOOTER", footer)
    monkeypatch.setattr(ft, "MAILING_ADDRESS_PLACEHOLDER", address)
    if override:
        monkeypatch.setenv("FOLLOWUP_ALLOW_LIVE_WITHOUT_ADDRESS", override)
    results = set()
    for url in URL_VALUES:
        monkeypatch.setattr(ft, "FEEDBACK_URL", url)
        results.add((ft.compliance_footer_text(), ft.compliance_footer_html(), ce.custom_email_live_ready()))
    assert len(results) == 1


@pytest.mark.parametrize("footer,address,override", itertools.product(
    [False, True], [ft._DEFAULT_MAILING_ADDRESS_PLACEHOLDER, "100 Example Ave, Portland, OR 97200"], [None, "true"],
))
def test_followup_live_ready_with_shipped_link(monkeypatch, shipped_url, footer, address, override):
    monkeypatch.setattr(ft, "INCLUDE_COMPLIANCE_FOOTER", footer)
    monkeypatch.setattr(ft, "MAILING_ADDRESS_PLACEHOLDER", address)
    if override:
        monkeypatch.setenv("FOLLOWUP_ALLOW_LIVE_WITHOUT_ADDRESS", override)
    address_real = address != ft._DEFAULT_MAILING_ADDRESS_PLACEHOLDER
    assert ft.is_live_ready() is (bool(override) or (footer and address_real))


def test_custom_email_output_independent_of_link(monkeypatch):
    outputs = []
    for url in URL_VALUES:
        monkeypatch.setattr(ft, "FEEDBACK_URL", url)
        outputs.append(ce.render_custom_email("Hi {{first_name}}", "Hello {{first_name}}", "Jordan Testerson"))
    assert outputs[0] == outputs[1] == outputs[2]
    assert REVIEW_URL not in outputs[0]["body_html"]
