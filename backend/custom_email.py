"""Custom Email: owner-written (or AI-drafted) one-off email to an uploaded
customer list (POST /custom-email/render, /custom-email/send,
/custom-email/generate — see main.py).

Reuses followup_templates for the first-name rule, the standard signature,
and the compliance footer rather than duplicating them. Placeholder handling
({{first_name}} / {{full_name}}) and the AI-generation prompt/parsing live
here since they're specific to this feature.
"""

from __future__ import annotations

import html as _html
import json as _json
import re as _re

import followup_templates as _ft

_KNOWN_PLACEHOLDERS = {"first_name", "full_name"}

# {{first_name}}, {{ First_Name }}, etc. — case-insensitive, any amount of
# leading/trailing whitespace inside the braces.
_PLACEHOLDER_RE = _re.compile(r"\{\{\s*([^{}]+?)\s*\}\}")

_TONES = {"friendly", "professional", "short"}


def _dedupe(items: list[str]) -> list[str]:
    seen, out = set(), []
    for item in items:
        key = item.lower()
        if key not in seen:
            seen.add(key)
            out.append(item)
    return out


def full_name_of(name: str) -> str:
    """Whitespace-collapsed full name, or 'there' when blank."""
    collapsed = " ".join((name or "").split())
    return collapsed if collapsed else "there"


def unknown_placeholders(text: str) -> list[str]:
    """Every {{...}} token in text that isn't {{first_name}} or {{full_name}}
    (case-insensitive), in order of first appearance, deduplicated."""
    found = []
    for m in _PLACEHOLDER_RE.finditer(text or ""):
        token = m.group(1).strip()
        if token.lower() not in _KNOWN_PLACEHOLDERS:
            found.append("{{" + token + "}}")
    return _dedupe(found)


def substitute_placeholders(text: str, first_name: str, full_name: str) -> str:
    """Replace {{first_name}}/{{full_name}} (case-insensitive, any spacing)
    with the given values. Unknown {{...}} tokens are left untouched — they
    are reported as warnings elsewhere, never silently dropped or guessed."""
    def repl(m: "_re.Match[str]") -> str:
        token = m.group(1).strip().lower()
        if token == "first_name":
            return first_name
        if token == "full_name":
            return full_name
        return m.group(0)

    return _PLACEHOLDER_RE.sub(repl, text or "")


def _paragraphs_to_html(escaped_text: str) -> str:
    """Blank lines -> paragraph breaks, single newlines -> <br>. Input must
    already be HTML-escaped — this never looks at raw user text."""
    blocks = _re.split(r"\n\s*\n", escaped_text.strip())
    parts = [f"<p>{block.replace(chr(10), '<br>')}</p>" for block in blocks if block.strip()]
    return "\n".join(parts)


def render_custom_email(subject: str, body: str, name: str) -> dict:
    """Build {subject, body_text, body_html, warnings} for one recipient.

    The body is plain text typed (or AI-drafted then edited) by the owner —
    it is HTML-escaped before any markup is added, so raw HTML never reaches
    the rendered email; the substituted name value is escaped along with
    everything else since substitution happens before escaping. Appends the
    shared signature (see followup_templates.signature_text/html) and the
    compliance footer only when followup_templates.INCLUDE_COMPLIANCE_FOOTER
    is True — same switch the follow-up template uses.
    """
    subject = subject or ""
    body = body or ""

    warnings: list[str] = []

    first_name = _ft._first_name(name)
    full_name = full_name_of(name)
    if first_name == "there":
        warnings.append('Name is empty or looks like a business — used "there" as the greeting.')

    unknown = _dedupe(unknown_placeholders(subject) + unknown_placeholders(body))
    if unknown:
        warnings.append("Unknown placeholder(s): " + ", ".join(unknown))

    if not subject.strip():
        warnings.append("Subject is empty.")
    if not body.strip():
        warnings.append("Message is empty.")

    subject_out = substitute_placeholders(subject, first_name, full_name).replace("\r", "").replace("\n", "")
    body_sub = substitute_placeholders(body, first_name, full_name)

    sig_text = _ft.signature_text()
    footer_text = _ft.compliance_footer_text()
    body_text = (f"{body_sub.rstrip()}\n\n{sig_text}" if body_sub.strip() else sig_text) + footer_text

    body_html_paragraphs = _paragraphs_to_html(_html.escape(body_sub))
    sig_html = _ft.signature_html()
    footer_html = _ft.compliance_footer_html()
    body_html = (f"{body_html_paragraphs}\n{sig_html}" if body_html_paragraphs else sig_html) + footer_html

    return {"subject": subject_out, "body_text": body_text, "body_html": body_html, "warnings": warnings}


def custom_email_live_ready() -> bool:
    """True only once the compliance footer is on AND a real mailing address
    has replaced the placeholder — same bar as followup_templates.is_live_ready,
    minus the follow-up template's own FEEDBACK_URL/subject requirements, which
    don't apply to a custom email. Used to gate live (non-test) sending in
    /custom-email/send — see main.py."""
    return (
        _ft.INCLUDE_COMPLIANCE_FOOTER
        and _ft.MAILING_ADDRESS_PLACEHOLDER != _ft._DEFAULT_MAILING_ADDRESS_PLACEHOLDER
    )


def normalize_tone(tone: str) -> str:
    t = (tone or "").strip().lower()
    return t if t in _TONES else "friendly"


def build_generate_system_prompt(tone: str, word_limit: int) -> str:
    """Fixed business context + rules for POST /custom-email/generate. Must
    never include any customer name, email, or uploaded list data — only the
    owner's instruction (sent separately as the user message), the tone, and
    this fixed text are ever sent to the model."""
    return (
        "You write short outreach emails for Willamette Power Roofing, a roofing, gutter "
        "cleaning, pressure washing and moss treatment company in Portland, Oregon, owned by "
        "Gus and Ajay. Write as \"we\". Start the body with a greeting using the placeholder "
        "{{first_name}} exactly (e.g. \"Hi {{first_name}},\"). Use ONLY {{first_name}} and "
        "{{full_name}} as placeholders; never invent any other placeholder. Plain text only: "
        "no markdown, no HTML. Do NOT include a signature, sign-off name, phone number, "
        "website, email address, license number, or any link — the app adds the signature "
        "automatically. Do NOT invent prices, discounts, warranties, guarantees, deadlines, "
        "statistics, awards, customer names, or any claim the owner did not state in their "
        "instruction. Keep the body under " + str(word_limit) + " words. The subject must be "
        "under 8 words, no ALL CAPS, no exclamation marks, no emojis. End the body with a "
        "gentle invitation to reply. Tone: " + tone + ". "
        'Return ONLY a JSON object of the exact form {"subject": "...", "body": "..."} '
        "with no other text, no code fences, and no explanation."
    )


def parse_generate_reply(raw_text: str) -> dict:
    """Defensively parse the model's reply: strip a ```...``` code fence if
    present, find the first {...} JSON object, and require subject/body
    strings. Raises ValueError on anything that doesn't fit — callers should
    turn that into the generic 502 (never surface provider/parse details)."""
    text = (raw_text or "").strip()
    fence = _re.search(r"```(?:json)?\s*(.*?)```", text, _re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    brace = _re.search(r"\{.*\}", text, _re.DOTALL)
    if not brace:
        raise ValueError("No JSON object found in model reply.")
    data = _json.loads(brace.group(0))
    subject = data.get("subject")
    body = data.get("body")
    if not isinstance(subject, str) or not isinstance(body, str):
        raise ValueError("Model reply missing subject/body strings.")
    return {"subject": subject, "body": body}
