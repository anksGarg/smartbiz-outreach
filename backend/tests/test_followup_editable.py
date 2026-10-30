"""Owner-editable follow-up subject/body: placeholders, validation, escaping,
fixed signature/footer, and preview (/followup/draft) == send (/followup/send)."""

from __future__ import annotations

import pytest

import followup_templates as ft
from conftest import followup_item

YEARS = {"Jordan Testerson": "2023", "Casey Example": "2021", "Riley Sample": "2019"}


def _items_with_years():
    return [
        followup_item("Jordan Testerson", "jordan@example.com", last_service_date="2023-04-12"),
        followup_item("Casey Example", "casey@example.com", last_service="Pressure Washing", last_service_date="5/1/2021"),
        followup_item("Riley Sample", "riley@example.com", has_reroofing=True, reroofing_last_date="2019-09-01",
                      last_service="Re-Roofing"),
    ]


# ── {{year}} removal applies to every recipient ──────────────────────────────

def test_year_appears_by_default_for_every_recipient(client, live_env):
    resp = client.post("/followup/send", json={"items": _items_with_years()})
    assert resp.status_code == 200
    sent = live_env.all_sent()
    assert len(sent) == 3
    for message in sent:
        name = next(n for n in YEARS if n.split()[0] in message["text"])
        assert YEARS[name] in message["text"]


def test_deleting_year_removes_it_for_every_recipient(client, live_env):
    with_year = "Hi {{first_name}},\n\nThanks for trusting us with your {{service}} in {{year}}."
    without_year = "Hi {{first_name}},\n\nThanks for trusting us with your {{service}}."
    resp = client.post("/followup/send", json={
        "items": _items_with_years(),
        "custom_text_by_template": {"with_reroofing": without_year, "without_reroofing": without_year},
    })
    assert resp.status_code == 200
    sent = live_env.all_sent()
    assert len(sent) == 3
    for message in sent:
        for year in YEARS.values():
            assert year not in message["text"]
            assert year not in message["html"]
    # Sanity: the same text WITH {{year}} does show each recipient's year.
    for item in _items_with_years():
        resp = client.post("/followup/draft", json={**item, "custom_text": with_year})
        assert YEARS[item["name"]] in resp.json()["body_text"]


# ── every placeholder ────────────────────────────────────────────────────────

@pytest.mark.parametrize("token,expected", [
    ("first_name", "Riley"),
    ("full_name", "Riley Sample"),
    ("service", "re-roofing"),
    ("year", "2019"),
    ("service_phrase", "re-roofing in 2019"),
    ("reroofing_year", "2019"),
    (" First_Name ", "Riley"),  # case-insensitive, any spacing
])
def test_each_placeholder_substitutes_in_body_and_subject(client, token, expected):
    resp = client.post("/followup/draft", json={
        **followup_item("Riley Sample", last_service="Re-Roofing", has_reroofing=True, reroofing_last_date="2019-09-01"),
        "custom_text": f"Value: <{{{{{token}}}}}>",
        "custom_subject": f"Subject {{{{{token}}}}}",
    })
    assert resp.status_code == 200
    body = resp.json()
    assert f"Value: <{expected}>" in body["body_text"]
    assert body["subject"] == f"Subject {expected}"
    assert "{{" not in body["body_text"] and "{{" not in body["subject"]


def test_service_placeholders_without_reroofing(client):
    resp = client.post("/followup/draft", json={
        **followup_item("Jordan Testerson", last_service="Pressure Washing", last_service_date="2022-03-03"),
        "custom_text": "{{service}}|{{year}}|{{service_phrase}}|{{reroofing_year}}|",
    })
    assert "pressure washing|2022|pressure washing in 2022||" in resp.json()["body_text"]


def test_template_text_and_subject_are_echoed_unsubstituted(client):
    resp = client.post("/followup/draft", json={
        **followup_item(), "custom_text": "Hi {{first_name}}", "custom_subject": "For {{first_name}}",
    })
    body = resp.json()
    assert body["template_text"] == "Hi {{first_name}}"
    assert body["template_subject"] == "For {{first_name}}"


# ── unknown placeholders ─────────────────────────────────────────────────────

@pytest.mark.parametrize("field", ["custom_text", "custom_subject"])
def test_unknown_placeholder_rejected_on_draft(client, field):
    resp = client.post("/followup/draft", json={**followup_item(), field: "Hello {{last_name}}"})
    assert resp.status_code == 400
    assert "{{last_name}}" in resp.json()["detail"]


@pytest.mark.parametrize("field", ["custom_text_by_template", "custom_subject_by_template"])
def test_unknown_placeholder_rejected_on_send_and_nothing_sent(client, smtp_env, field):
    resp = client.post("/followup/send", json={
        "items": [followup_item()], field: {"without_reroofing": "Hello {{coupon_code}}"},
    })
    assert resp.status_code == 400
    assert "{{coupon_code}}" in resp.json()["detail"]
    assert smtp_env.instances == []


def test_unknown_template_key_rejected_on_send(client, smtp_env):
    resp = client.post("/followup/send", json={
        "items": [followup_item()], "custom_text_by_template": {"bogus": "Hi {{first_name}}"},
    })
    assert resp.status_code == 400
    assert smtp_env.instances == []


# ── length caps ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("field,limit", [("custom_subject", 150), ("custom_text", 3000)])
def test_length_caps_on_draft(client, field, limit):
    ok = client.post("/followup/draft", json={**followup_item(), field: "x" * limit})
    too_long = client.post("/followup/draft", json={**followup_item(), field: "x" * (limit + 1)})
    assert ok.status_code == 200
    assert too_long.status_code == 400
    assert str(limit) in too_long.json()["detail"]


@pytest.mark.parametrize("field,limit", [("custom_subject_by_template", 150), ("custom_text_by_template", 3000)])
def test_length_caps_on_send(client, smtp_env, field, limit):
    ok = client.post("/followup/send", json={"items": [followup_item()], field: {"without_reroofing": "x" * limit}})
    assert ok.status_code == 200
    smtp_env.instances.clear()
    too_long = client.post("/followup/send", json={"items": [followup_item()], field: {"without_reroofing": "x" * (limit + 1)}})
    assert too_long.status_code == 400
    assert smtp_env.instances == []


# ── escaping and header safety ───────────────────────────────────────────────

def test_script_in_custom_text_is_html_escaped(client):
    resp = client.post("/followup/draft", json={
        **followup_item(), "custom_text": 'Hi {{first_name}}\n\n<script>alert("x")</script> <b>bold</b>',
    })
    html = resp.json()["body_html"]
    assert "<script" not in html.lower()
    assert "<b>" not in html
    assert "&lt;script&gt;" in html


def test_script_in_customer_name_is_html_escaped(client):
    resp = client.post("/followup/draft", json={
        **followup_item(name="Pat <script>x</script>"), "custom_text": "Dear {{full_name}}",
    })
    html = resp.json()["body_html"]
    assert "<script" not in html.lower()
    assert "&lt;script&gt;" in html


def test_crlf_stripped_from_custom_subject_on_draft(client):
    resp = client.post("/followup/draft", json={
        **followup_item(), "custom_subject": "Hello {{first_name}}\r\nBcc: attacker@example.com",
    })
    subject = resp.json()["subject"]
    assert "\r" not in subject and "\n" not in subject
    assert subject == "Hello JordanBcc: attacker@example.com"


def test_crlf_in_subject_cannot_inject_headers_on_send(client, live_env):
    resp = client.post("/followup/send", json={
        "items": [followup_item(name="Jordan\r\nBcc: attacker@example.com")],
        "custom_subject_by_template": {"without_reroofing": "Hi {{first_name}}\r\nBcc: attacker@example.com"},
    })
    assert resp.status_code == 200
    (message,) = live_env.all_sent()
    assert message["msg"]["Bcc"] is None
    assert "\n" not in message["subject"] and "\r" not in message["subject"]
    assert message["to"] == ["jordan@example.com"]


# ── signature and opt-out/footer are always appended ─────────────────────────

@pytest.mark.parametrize("custom_text", ["Hi {{first_name}}", "Regards,\nSomeone Else", "   x   "])
def test_signature_and_opt_out_always_present(client, custom_text):
    body = client.post("/followup/draft", json={**followup_item(), "custom_text": custom_text}).json()
    assert body["body_text"].endswith(f"{ft.signature_text()}\n\n{ft.OPT_OUT_LINE}")
    assert ft.signature_html() in body["body_html"]
    assert body["body_html"].endswith(ft.compliance_footer_html())


def test_full_footer_replaces_opt_out_when_address_is_real(client, monkeypatch):
    monkeypatch.setattr(ft, "INCLUDE_COMPLIANCE_FOOTER", True)
    monkeypatch.setattr(ft, "MAILING_ADDRESS_PLACEHOLDER", "100 Example Ave, Portland, OR 97200")
    body = client.post("/followup/draft", json={**followup_item(), "custom_text": "Hi"}).json()
    assert body["body_text"].endswith(f"{ft.UNSUBSCRIBE_LINE}\n100 Example Ave, Portland, OR 97200")
    assert ft.signature_text() in body["body_text"]


def test_custom_text_cannot_remove_signature_or_footer_on_send(client, live_env):
    client.post("/followup/send", json={
        "items": [followup_item()], "custom_text_by_template": {"without_reroofing": "Short note."},
    })
    (message,) = live_env.all_sent()
    assert ft.signature_text() in message["text"]
    assert ft.OPT_OUT_LINE in message["text"]


# ── preview == send ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("custom", [
    {},
    {"custom_text": "Hi {{first_name}},\n\nYour {{service_phrase}} — thanks!\n\nLeave a Google review? Call 503-410-6919.",
     "custom_subject": "{{first_name}}, a note about your {{service}}"},
])
@pytest.mark.parametrize("template", ["with_reroofing", "without_reroofing"])
def test_preview_output_equals_send_output(client, live_env, monkeypatch, custom, template):
    monkeypatch.setattr(ft, "FEEDBACK_URL", "https://example.com/review")
    items = [
        followup_item("Jordan Testerson", "jordan@example.com", template=template),
        followup_item("Riley Sample", "riley@example.com", template=template, has_reroofing=True,
                      last_service="Re-Roofing", reroofing_last_date="2019-09-01"),
    ]
    send_payload = {"items": items}
    if custom:
        send_payload["custom_text_by_template"] = {template: custom["custom_text"]}
        send_payload["custom_subject_by_template"] = {template: custom["custom_subject"]}
    assert client.post("/followup/send", json=send_payload).status_code == 200
    sent = live_env.all_sent()
    assert len(sent) == len(items)

    for item, message in zip(items, sent):
        draft_payload = {k: v for k, v in item.items() if k != "email"}
        preview = client.post("/followup/draft", json={**draft_payload, **custom}).json()
        assert message["to"] == [item["email"]]
        assert message["subject"] == preview["subject"]
        assert message["text"].rstrip("\n") == preview["body_text"]
        assert message["html"].rstrip("\n") == preview["body_html"]
