"""Shared fixtures. Hard rules for every test in this folder:

- backend/.env is never read: dotenv.load_dotenv is replaced with a no-op
  BEFORE main is imported, and every env var a test needs is set with
  monkeypatch (everything else relevant is cleared).
- No network: smtplib.SMTP and anthropic.Anthropic are always replaced with
  fakes; a test that forgets to configure one gets a loud failure, not a send.
- Synthetic names/addresses only (example.com / example.test).
"""

from __future__ import annotations

import email
import email.policy
import smtplib
import sys
from pathlib import Path

import dotenv
import pytest

dotenv.load_dotenv = lambda *args, **kwargs: False  # must run before `import main`

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

import followup_templates as ft  # noqa: E402
import main  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

# Captured at import, before _isolate resets it per test — lets
# test_review_link.py check the real shipped value.
SHIPPED_FEEDBACK_URL = ft.FEEDBACK_URL

TEST_RECIPIENT = "owner-inbox@example.test"
SMTP_USER = "sender@example.test"
SMTP_PASSWORD = "not-a-real-app-password"

# Every env var the email code paths read — cleared before each test so a
# developer's shell can't leak into results.
_ENV_VARS = [
    "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_APP_PASSWORD",
    "FOLLOWUP_SEND_MODE", "FOLLOWUP_TEST_RECIPIENT", "FOLLOWUP_ALLOW_LIVE_WITHOUT_ADDRESS",
    "ANTHROPIC_API_KEY", "BREVO_API_KEY", "BREVO_FROM_EMAIL",
    "CUSTOMERS_SHEET_ID", "GOOGLE_CREDENTIALS_JSON", "GOOGLE_SHEET_ID",
]


class FakeSMTP:
    """Records every connection; never touches the network."""

    instances: list["FakeSMTP"] = []
    login_error: Exception | None = None
    fail_for: set[str] = set()  # display names whose sendmail raises

    def __init__(self, host, port, timeout=None):
        self.host, self.port = host, port
        self.logins: list[tuple[str, str]] = []
        self.sent: list[dict] = []
        self.quit_called = False
        self.closed = False
        FakeSMTP.instances.append(self)

    def starttls(self):
        pass

    def login(self, user, password):
        if FakeSMTP.login_error is not None:
            raise FakeSMTP.login_error
        self.logins.append((user, password))

    def sendmail(self, from_addr, to_addrs, msg_string):
        msg = email.message_from_string(msg_string, policy=email.policy.default)
        if any(name in str(msg["Subject"]) for name in FakeSMTP.fail_for):
            raise smtplib.SMTPRecipientsRefused({to_addrs[0]: (550, b"mailbox unavailable for someone@example.com")})
        self.sent.append({
            "from": from_addr,
            "to": list(to_addrs),
            "msg": msg,
            "subject": str(msg["Subject"]),
            "text": msg.get_body(("plain",)).get_content(),
            "html": msg.get_body(("html",)).get_content(),
        })

    def quit(self):
        self.quit_called = True

    def close(self):
        self.closed = True

    @classmethod
    def all_sent(cls) -> list[dict]:
        return [m for inst in cls.instances for m in inst.sent]


class _NoAnthropic:
    def __init__(self, *args, **kwargs):
        raise AssertionError("anthropic.Anthropic was called without a test fake")


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    for var in _ENV_VARS:
        monkeypatch.delenv(var, raising=False)
    FakeSMTP.instances = []
    FakeSMTP.login_error = None
    FakeSMTP.fail_for = set()
    monkeypatch.setattr(main.smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(main.anthropic, "Anthropic", _NoAnthropic)
    monkeypatch.setattr(main._time, "sleep", lambda seconds: None)
    monkeypatch.setitem(main._LAST_GENERATE_AT, "ts", 0.0)
    # Placeholder baseline for the template constants (not the shipped
    # FEEDBACK_URL — see SHIPPED_FEEDBACK_URL) — individual tests override these.
    monkeypatch.setattr(ft, "FEEDBACK_URL", ft._DEFAULT_FEEDBACK_URL)
    monkeypatch.setattr(ft, "INCLUDE_COMPLIANCE_FOOTER", False)
    monkeypatch.setattr(ft, "MAILING_ADDRESS_PLACEHOLDER", ft._DEFAULT_MAILING_ADDRESS_PLACEHOLDER)


@pytest.fixture
def client():
    return TestClient(main.app)


@pytest.fixture
def smtp_env(monkeypatch):
    """SMTP + test-mode settings (the shipped default mode)."""
    monkeypatch.setenv("SMTP_HOST", "smtp.example.test")
    monkeypatch.setenv("SMTP_PORT", "587")
    monkeypatch.setenv("SMTP_USER", SMTP_USER)
    monkeypatch.setenv("SMTP_APP_PASSWORD", SMTP_PASSWORD)
    monkeypatch.setenv("FOLLOWUP_TEST_RECIPIENT", TEST_RECIPIENT)
    return FakeSMTP


@pytest.fixture
def live_env(smtp_env, monkeypatch):
    """Live mode, allowed via the no-address override — so sent messages
    carry no TEST banner/prefix and can be compared byte-for-byte."""
    monkeypatch.setenv("FOLLOWUP_SEND_MODE", "live")
    monkeypatch.setenv("FOLLOWUP_ALLOW_LIVE_WITHOUT_ADDRESS", "true")
    return smtp_env


def followup_item(name="Jordan Testerson", email_addr="jordan@example.com", **overrides):
    item = {
        "name": name,
        "email": email_addr,
        "last_service": "Gutter Cleaning",
        "last_service_date": "2023-04-12",
        "has_reroofing": False,
        "reroofing_last_date": "",
        "business_signal": False,
        "template": "",
    }
    item.update(overrides)
    return item
