"""Shared send loop safety (/followup/send and /custom-email/send): per-request
cap, email dedupe, one SMTP login per request, generic errors, and logs that
never contain email addresses or message/exception text."""

from __future__ import annotations

import smtplib

import pytest

from conftest import SMTP_PASSWORD, SMTP_USER, TEST_RECIPIENT, followup_item

CUSTOM_PAYLOAD = {"subject": "Hello {{first_name}}", "body": "Hi {{first_name}}, a quick note."}
ENDPOINTS = ["/followup/send", "/custom-email/send"]


def _send(client, endpoint: str, items: list[dict]):
    if endpoint == "/followup/send":
        return client.post(endpoint, json={"items": items})
    return client.post(endpoint, json={**CUSTOM_PAYLOAD, "items": [{"name": i["name"], "email": i["email"]} for i in items]})


def _items(n: int) -> list[dict]:
    return [followup_item(f"Person{i} Example", f"person{i}@example.com") for i in range(n)]


def _assert_logs_clean(logs: str, items: list[dict]) -> None:
    assert "@" not in logs
    for item in items:
        assert item["email"] not in logs
    assert SMTP_PASSWORD not in logs
    assert "Hi " not in logs and "quick note" not in logs and "Willamette" not in logs


# ── cap ──────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_cap_of_50_per_request(client, smtp_env, endpoint):
    too_many = _send(client, endpoint, _items(51))
    assert too_many.status_code == 400
    assert "50" in too_many.json()["detail"]
    assert smtp_env.instances == []

    at_cap = _send(client, endpoint, _items(50))
    assert at_cap.status_code == 200
    assert len(at_cap.json()["sent"]) == 50
    assert len(smtp_env.all_sent()) == 50


# ── dedupe / invalid ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_dedupe_by_email_case_insensitive(client, smtp_env, endpoint):
    items = [
        followup_item("Jordan Testerson", "jordan@example.com"),
        followup_item("Jordan Again", "  JORDAN@Example.com "),
        followup_item("Casey Example", "casey@example.com"),
    ]
    body = _send(client, endpoint, items).json()
    assert body["sent"] == ["Jordan Testerson", "Casey Example"]
    assert body["skipped"] == [{"name": "Jordan Again", "reason": "duplicate email in this request"}]
    assert len(smtp_env.all_sent()) == 2


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_invalid_email_skipped(client, smtp_env, endpoint):
    items = [followup_item("No Email", ""), followup_item("Bad Email", "not-an-email"),
             followup_item("Good Email", "good@example.com")]
    body = _send(client, endpoint, items).json()
    assert body["sent"] == ["Good Email"]
    assert [s["name"] for s in body["skipped"]] == ["No Email", "Bad Email"]


# ── one SMTP login per request ───────────────────────────────────────────────

@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_one_smtp_connection_and_login_per_request(client, smtp_env, endpoint):
    assert _send(client, endpoint, _items(5)).status_code == 200
    (conn,) = smtp_env.instances
    assert conn.logins == [(SMTP_USER, SMTP_PASSWORD)]
    assert len(conn.sent) == 5
    assert conn.quit_called


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_smtp_not_configured_is_500_and_nothing_sent(client, endpoint, monkeypatch):
    monkeypatch.setenv("FOLLOWUP_TEST_RECIPIENT", TEST_RECIPIENT)
    resp = _send(client, endpoint, _items(1))
    assert resp.status_code == 500
    assert resp.json()["detail"] == "SMTP settings are not fully configured."


# ── login failure ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_login_failure_is_generic_502_with_no_mail(client, smtp_env, capsys, endpoint):
    smtp_env.login_error = smtplib.SMTPAuthenticationError(
        535, f"5.7.8 Username and Password not accepted for {SMTP_USER}".encode()
    )
    items = _items(3)
    resp = _send(client, endpoint, items)
    assert resp.status_code == 502
    assert resp.json() == {"detail": "SMTP login failed. Check the sending account settings."}
    (conn,) = smtp_env.instances
    assert conn.sent == []
    assert conn.closed

    logs = capsys.readouterr().out
    assert "SMTPAuthenticationError code=535" in logs
    assert "not accepted" not in logs
    _assert_logs_clean(logs, items)


# ── per-message failure and log hygiene ──────────────────────────────────────

@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_per_message_failure_is_generic_and_logs_are_clean(client, smtp_env, capsys, endpoint):
    items = _items(3)
    smtp_env.fail_for = {"Person1 Example"}
    body = _send(client, endpoint, items).json()
    assert body["sent"] == ["Person0 Example", "Person2 Example"]
    assert body["failed"] == [{"name": "Person1 Example", "error": "Could not send email."}]

    logs = capsys.readouterr().out
    assert "SMTPRecipientsRefused" in logs
    assert "mailbox unavailable" not in logs
    _assert_logs_clean(logs, items)


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_successful_send_logs_contain_no_addresses(client, live_env, capsys, endpoint):
    items = _items(2)
    assert _send(client, endpoint, items).status_code == 200
    _assert_logs_clean(capsys.readouterr().out, items)
