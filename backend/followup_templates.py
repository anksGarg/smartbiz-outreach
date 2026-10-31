"""Deterministic follow-up email template (POST /followup/draft).

No AI call — render_followup_email() builds the subject/body_text/body_html
directly from fixed copy below, with a few conditional sections and fill-ins.
Edit the paragraph strings inside render_followup_email() (or the constants
below) to change wording; nothing else in main.py needs to change.
"""

from __future__ import annotations

import html as _html
import os as _os
import re as _re

CATEGORIES = ["Re-Roofing", "Gutter Cleaning", "Pressure Washing"]

# ── Shared placeholder/paragraph helpers (also used by custom_email.py) ────
# Live here, not in custom_email.py, specifically so this module never has to
# import custom_email.py back — custom_email.py already imports this module,
# and the reverse would be a circular import.

KNOWN_PLACEHOLDERS = {"first_name", "full_name"}

# The follow-up template's whole body/subject is placeholder text (not just
# name fields) — service/year/service_phrase/reroofing_year are per-customer
# history, computed in render_followup_email() and passed into
# substitute_placeholders() alongside first_name/full_name.
FOLLOWUP_KNOWN_PLACEHOLDERS = KNOWN_PLACEHOLDERS | {"service", "year", "service_phrase", "reroofing_year"}

# {{first_name}}, {{ First_Name }}, etc. — case-insensitive, any amount of
# leading/trailing whitespace inside the braces.
_PLACEHOLDER_RE = _re.compile(r"\{\{\s*([^{}]+?)\s*\}\}")


def dedupe_strings(items: list[str]) -> list[str]:
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


def unknown_placeholders(text: str, known: set[str] = KNOWN_PLACEHOLDERS) -> list[str]:
    """Every {{...}} token in text that isn't in `known` (case-insensitive),
    in order of first appearance, deduplicated. Custom Email calls this with
    the default (first_name/full_name only); the follow-up template passes
    FOLLOWUP_KNOWN_PLACEHOLDERS instead — see main.py."""
    found = []
    for m in _PLACEHOLDER_RE.finditer(text or ""):
        token = m.group(1).strip()
        if token.lower() not in known:
            found.append("{{" + token + "}}")
    return dedupe_strings(found)


def substitute_placeholders(text: str, values: dict[str, str]) -> str:
    """Replace every {{token}} (case-insensitive, any spacing) whose
    lowercased name is a key in `values` with that value. Unknown {{...}}
    tokens are left untouched — they are reported as warnings/errors
    elsewhere, never silently dropped or guessed. Custom Email passes
    {"first_name": ..., "full_name": ...}; the follow-up template passes
    those plus service/year/service_phrase/reroofing_year."""
    def repl(m: "_re.Match[str]") -> str:
        token = m.group(1).strip().lower()
        return values.get(token, m.group(0))

    return _PLACEHOLDER_RE.sub(repl, text or "")


def paragraphs_to_html(escaped_text: str) -> str:
    """Blank lines -> paragraph breaks, single newlines -> <br>. Input must
    already be HTML-escaped — this never looks at raw user text."""
    blocks = _re.split(r"\n\s*\n", escaped_text.strip())
    parts = [f"<p>{block.replace(chr(10), '<br>')}</p>" for block in blocks if block.strip()]
    return "\n".join(parts)

# Plain-text unsubscribe line, appended to the body after generation (not left
# to any template logic to skip, so it's always present verbatim when on).
UNSUBSCRIBE_LINE = (
    "If you'd rather not hear from us again, just reply and let us know and we'll take you off our list."
)

# Supplied by the business owner — do not invent a real address here.
MAILING_ADDRESS_PLACEHOLDER = "[BUSINESS MAILING ADDRESS]"

# Must be True, with a real mailing address, before any email goes to a real
# customer. The future send step must refuse non-test recipients while this
# is False.
INCLUDE_COMPLIANCE_FOOTER = False

# Owner-approved fixed subject — same for every template, not a placeholder.
SUBJECT = "Checking in from Willamette Power Roofing"

# Owner-supplied Google review link.
# FEEDBACK_URL only becomes a clickable link once it's a real https:// URL.
FEEDBACK_URL = "https://g.page/r/CXk_0yKFsLBNEAI/review"

# Literal default values for the placeholders above — used by is_live_ready()
# to detect whether the owner has actually supplied real copy yet. SUBJECT is
# no longer one of these: it's owner-approved fixed copy, not a placeholder.
_DEFAULT_MAILING_ADDRESS_PLACEHOLDER = "[BUSINESS MAILING ADDRESS]"
_DEFAULT_FEEDBACK_URL = "[GOOGLE REVIEW LINK]"


def live_override_enabled() -> bool:
    """True only when FOLLOWUP_ALLOW_LIVE_WITHOUT_ADDRESS is exactly "true"
    (case-insensitive, trimmed) — an explicit, opt-in production override
    that skips ONLY the mailing-address/footer readiness requirement below.
    Unset or any other value behaves exactly as before. This is the single
    shared gate: is_live_ready() below and custom_email.custom_email_live_ready()
    both call this one function — there is no other bypass."""
    return (_os.getenv("FOLLOWUP_ALLOW_LIVE_WITHOUT_ADDRESS") or "").strip().lower() == "true"


def is_live_ready() -> bool:
    """True once every placeholder above has been replaced with real copy
    AND the compliance footer has been turned on — OR when
    live_override_enabled() is True. Used to gate live (non-test) sending in
    /followup/send — see main.py."""
    if live_override_enabled():
        return True
    return (
        INCLUDE_COMPLIANCE_FOOTER
        and MAILING_ADDRESS_PLACEHOLDER != _DEFAULT_MAILING_ADDRESS_PLACEHOLDER
        and FEEDBACK_URL != _DEFAULT_FEEDBACK_URL
    )

_PHONE = "503-410-6919"
_EMAIL = "info@willametteroof.com"
_WEBSITE = "www.willametteroof.com"
_WEBSITE_URL = "https://www.willametteroof.com"


def signature_text() -> str:
    """Standard plain-text signature block, shared by the follow-up template
    and the custom email (see custom_email.py)."""
    return (
        "Regards,\n"
        "Gus and Ajay\n"
        "Owners, Willamette Power Roofing\n"
        f"{_PHONE} | {_EMAIL} | {_WEBSITE}\n"
        "CCB 260629 · WA WPRLLL*747CQ · Licensed, Bonded & Insured"
    )


def signature_html() -> str:
    """Standard HTML signature block, shared by the follow-up template and
    the custom email (see custom_email.py)."""
    return (
        "<p>Regards,<br>"
        "Gus and Ajay<br>"
        "Owners, Willamette Power Roofing<br>"
        f'<a href="tel:{_PHONE}">{_PHONE}</a> | '
        f'<a href="mailto:{_EMAIL}">{_EMAIL}</a> | '
        f'<a href="{_WEBSITE_URL}">{_WEBSITE}</a><br>'
        "CCB 260629 · WA WPRLLL*747CQ · Licensed, Bonded &amp; Insured</p>"
    )


# Minimal one-line opt-out, used whenever the full compliance footer (the
# unsubscribe line plus the real mailing address) isn't both on AND ready —
# so every email carries at least this, and the address placeholder can
# never leak into a live send via the FOLLOWUP_ALLOW_LIVE_WITHOUT_ADDRESS
# override (see live_override_enabled()).
OPT_OUT_LINE = "If you'd rather not receive emails from us, just reply and we'll take you off our list."


def _mailing_address_is_real() -> bool:
    return MAILING_ADDRESS_PLACEHOLDER != _DEFAULT_MAILING_ADDRESS_PLACEHOLDER


def compliance_footer_text() -> str:
    """Plain-text footer, appended at the end after the signature. Uses the
    full unsubscribe + mailing-address footer only when INCLUDE_COMPLIANCE_FOOTER
    is on AND a real address has replaced the placeholder; otherwise falls
    back to the minimal OPT_OUT_LINE so the placeholder text can never appear
    in a rendered email (e.g. during a live send via the no-address
    override). Shared by the follow-up template and the custom email (see
    custom_email.py)."""
    if INCLUDE_COMPLIANCE_FOOTER and _mailing_address_is_real():
        return f"\n\n{UNSUBSCRIBE_LINE}\n{MAILING_ADDRESS_PLACEHOLDER}"
    return f"\n\n{OPT_OUT_LINE}"


def compliance_footer_html() -> str:
    """HTML footer — same rule as compliance_footer_text(). Shared by the
    follow-up template and the custom email (see custom_email.py)."""
    if INCLUDE_COMPLIANCE_FOOTER and _mailing_address_is_real():
        return f"<p>{_html.escape(UNSUBSCRIBE_LINE)}<br>{_html.escape(MAILING_ADDRESS_PLACEHOLDER)}</p>"
    return f"<p>{_html.escape(OPT_OUT_LINE)}</p>"

# Name-based "looks like a business, not a person" detector for {first_name}.
_BUSINESS_WORDS = {
    "llc", "inc", "corp", "co", "company", "roofing", "construction",
    "condo", "condos", "condominium", "condominiums", "apartment", "apartments",
    "hoa", "association", "associates", "partners", "partnership", "properties",
    "property", "management", "group", "services", "transportation", "townhome",
    "townhomes", "townhouse", "homeowners", "church", "ministry", "school", "club",
    "trust", "llp", "ltd", "enterprises", "holdings", "investments", "realty",
}

# Leading courtesy title, with or without a trailing period, stripped before
# taking the first name (e.g. "Dr. Alice Kim" -> "Alice Kim").
_TITLE_RE = _re.compile(r"^(dr|mr|mrs|ms|miss|mx|rev|prof)\.?\s+", _re.IGNORECASE)

# Name suffixes that can follow a comma without meaning "LAST, FIRST" order
# (e.g. "John Smith, Jr." is already FIRST LAST, not LAST, FIRST).
_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "md", "dds", "esq", "phd"}


def _year_of(date_str: str) -> str:
    """Pull just the year out of a date-ish string, in whatever format it arrives."""
    m = _re.search(r"(19|20)\d{2}", date_str or "")
    return m.group(0) if m else ""


def _first_name(name: str) -> str:
    """First given name out of name — or 'there' for blank/business/two-person names.

    Unicode-aware: accented letters (e.g. "José", "Martín") are never stripped.
    Only all-upper or all-lower words get title-cased; mixed-case words like
    "McDonald" or "DeAndre" are kept exactly as written. Handles "LAST, FIRST"
    order (takes the word after the comma) and strips a leading courtesy title
    (Dr, Mr, Mrs, Ms, Miss, Mx, Rev, Prof).
    """
    name = (name or "").strip()
    if not name:
        return "there"
    if _re.match(r"^\d", name):
        return "there"
    if "&" in name or _re.search(r"\band\b", name, _re.IGNORECASE):
        return "there"
    if _re.match(r"^the\s", name, _re.IGNORECASE):
        return "there"
    tokens = [t.strip(".,") for t in _re.split(r"[\s,]+", name.lower()) if t.strip(".,")]
    if any(t in _BUSINESS_WORDS for t in tokens):
        return "there"

    # "LAST, FIRST" -> use the part after the comma as the given name — unless
    # the part after the comma is only a suffix (Jr., III, PhD, ...), in which
    # case the name was already FIRST LAST and the part before the comma is
    # the one to use (e.g. "John Smith, Jr." -> "John Smith").
    if "," in name:
        before_comma, after_comma = name.split(",", 1)
        after_comma = after_comma.strip()
        after_comma_norm = after_comma.rstrip(".").lower()
        if after_comma and after_comma_norm not in _SUFFIXES:
            name = after_comma
        else:
            name = before_comma.strip()
        if not name:
            return "there"

    # Strip a leading courtesy title (with or without a trailing period). If
    # stripping it leaves only one word (e.g. "Mr. Smith" -> "Smith"), there's
    # no given name left to use.
    if _TITLE_RE.match(name):
        stripped = _TITLE_RE.sub("", name).strip()
        if not stripped or len(stripped.split()) == 1:
            return "there"
        name = stripped

    # Strip leading/trailing punctuation only — Unicode letters (incl. accents)
    # and internal characters like apostrophes/hyphens are left untouched.
    first_word = _re.sub(r"^[^\w]+|[^\w]+$", "", name.split()[0], flags=_re.UNICODE)
    if not first_word:
        return "there"
    if len(first_word) == 1:
        return "there"
    if first_word.isupper() or first_word.islower():
        return first_word.title()
    return first_word


# Default whole-body template per template key — used when no custom_text is
# supplied. Placeholder text: {{first_name}}/{{service_phrase}} get
# substituted per recipient at render time (see render_followup_email()).
# Reproduces today's hardcoded wording exactly — the opening sentence is no
# longer a separate, non-editable piece; it's just the template's own first
# paragraph like everything else.
_DEFAULT_TEMPLATE_TEXT = {
    "with_reroofing": (
        "Hi {{first_name}},\n\n"
        "It's Gus and Ajay from Willamette Power Roofing. Thank you for trusting us with your "
        "{{service_phrase}}. We don't take that lightly.\n\n"
        "With the rainy season close, now is a good time to clear moss and flush gutters before the first "
        "big storm. We can help with roof cleaning and moss treatment, gutter and downspout flushing, and "
        "new gutters if yours are sagging or undersized.\n\n"
        f"We'll start with a free inspection of your roof and gutters, so you know exactly what you need. "
        f"Just reply to this email or call/text {_PHONE}.\n\n"
        "Thanks again for your business. If you have a minute, please leave us a Google review."
    ),
    "without_reroofing": (
        "Hi {{first_name}},\n\n"
        "It's Gus and Ajay from Willamette Power Roofing. Thank you for trusting us with your "
        "{{service_phrase}}. We don't take that lightly.\n\n"
        "With the rainy season close, now is a good time to clear moss and flush gutters before the first "
        "big storm. We can help with roof cleaning and moss treatment, gutter and downspout flushing, and "
        "new gutters if yours are sagging or undersized.\n\n"
        "If you've been wondering how much life your roof has left, let's talk about it before it "
        "starts leaking — plan the timing on your terms, not the weather's. If you go ahead, it "
        "comes with a 50-year non-prorated warranty and our 15-year workmanship warranty.\n\n"
        f"We'll start with a free inspection of your roof and gutters, so you know exactly what you need. "
        f"Just reply to this email or call/text {_PHONE}.\n\n"
        "Thanks again for your business. If you have a minute, please leave us a Google review."
    ),
}

_REVIEW_MARKER = "Google review"


def _linkify_google_review(
    editable_text: str, editable_html: str, feedback_url_is_real: bool,
    feedback_url_html: str, feedback_url_raw: str,
) -> tuple[str, str]:
    """If FEEDBACK_URL is a real https:// URL, turn the first literal
    occurrence of "Google review" in the (already placeholder-substituted,
    already-escaped) editable text into a link (HTML) / append the URL
    right after it (plain text) — same user-visible behavior as before this
    text became owner-editable. If FEEDBACK_URL is still the bracketed
    placeholder, or the phrase isn't present at all (the owner edited it
    out), nothing changes — the placeholder string itself is never written
    into either output."""
    if not feedback_url_is_real:
        return editable_text, editable_html
    # Plain text: insert after the marker's own sentence-ending punctuation
    # (if any immediately follows it), so "...Google review." becomes
    # "...Google review. <url>" — the URL trails the sentence, not the bare
    # word, matching the pre-editable-text behavior.
    text_match = _re.search(_re.escape(_REVIEW_MARKER) + r"[.!?]?", editable_text)
    if text_match:
        insert_at = text_match.end()
        editable_text = editable_text[:insert_at] + f" {feedback_url_raw}" + editable_text[insert_at:]
    # HTML: link just the phrase itself, leaving any trailing punctuation
    # outside the <a> tag.
    if _REVIEW_MARKER in editable_html:
        editable_html = editable_html.replace(
            _REVIEW_MARKER, f'<a href="{feedback_url_html}">{_REVIEW_MARKER}</a>', 1
        )
    return editable_text, editable_html


def _linkify_phone(editable_html: str) -> str:
    """Turn the first literal occurrence of the phone number in the
    (already-escaped) editable HTML into a tel: link — same user-visible
    behavior as before this text became owner-editable, when the "Just
    reply... call/text {_PHONE}" sentence had its own hardcoded tel: link.
    Unconditional (unlike the review link, phone linking doesn't depend on
    any owner-supplied setting). No-op if the owner edited the number out."""
    if _PHONE in editable_html:
        editable_html = editable_html.replace(_PHONE, f'<a href="tel:{_PHONE}">{_PHONE}</a>', 1)
    return editable_html


def render_followup_email(
    name: str = "",
    last_service: str = "",
    last_service_date: str = "",
    has_reroofing: bool = False,
    reroofing_last_date: str = "",
    business_signal: bool = False,
    template: str | None = None,
    custom_text: str | None = None,
    custom_subject: str | None = None,
) -> dict:
    """Build {subject, template_subject, template_text, body_text, body_html}
    for one customer. Pure function — no network, no file I/O, no Sheets
    access.

    template ("with_reroofing" | "without_reroofing") controls ONLY which
    DEFAULT whole-body template is used when custom_text is None (the
    without_reroofing default adds the roof-replacement paragraph) — it is
    independent of the customer's real has_reroofing/reroofing_last_date
    history, which always still drives the {{service}}/{{year}} placeholder
    values. Any other/missing value falls back to the historical default:
    with_reroofing if has_reroofing else without_reroofing (this is what
    /followup/draft relies on).

    custom_text / custom_subject: the owner-edited whole-body template /
    subject for this template, applied to every customer who gets this
    template — NOT per customer. None (the default) uses
    _DEFAULT_TEMPLATE_TEXT / SUBJECT. Both may contain {{first_name}},
    {{full_name}}, {{service}}, {{year}}, {{service_phrase}}, or
    {{reroofing_year}} (case-insensitive, any spacing) — substituted here
    with this customer's own values; any other {{...}} token is left
    untouched (callers are expected to reject unknown placeholders before
    calling this — see main.py's _validate_followup_override). custom_text
    is always HTML-escaped before any markup is added, so raw HTML never
    reaches the rendered email. Only the signature and the compliance
    footer/opt-out line are never part of custom_text — they're always
    generated here, never editable.
    """
    if template not in ("with_reroofing", "without_reroofing"):
        template = "with_reroofing" if has_reroofing else "without_reroofing"

    first_name = "there" if business_signal else _first_name(name)
    full_name = full_name_of(name)

    if has_reroofing:
        service = "re-roofing"
        year = _year_of(reroofing_last_date)
    else:
        service = (last_service or "").strip().lower()
        year = _year_of(last_service_date)
    service_phrase = f"{service} in {year}" if year else service
    # Always the re-roofing year specifically, regardless of has_reroofing —
    # lets the with_reroofing template reference it even for a customer
    # whose {{service}}/{{year}} resolve to something else (template choice
    # is independent of real history, same as {{service}}/{{year}} already are).
    reroofing_year = _year_of(reroofing_last_date)

    placeholder_values = {
        "first_name": first_name,
        "full_name": full_name,
        "service": service,
        "year": year,
        "service_phrase": service_phrase,
        "reroofing_year": reroofing_year,
    }

    # === Whole body: one placeholder template, substituted per customer ===
    raw_template = custom_text if custom_text is not None else _DEFAULT_TEMPLATE_TEXT[template]
    substituted = substitute_placeholders(raw_template, placeholder_values)
    body_core_text = substituted.strip()
    body_core_html = paragraphs_to_html(_html.escape(substituted))

    # FEEDBACK_URL only becomes a clickable link / gets appended once it's a
    # real https:// URL — while it's still the bracketed placeholder, the
    # review ask (wherever it ends up in the template text) stays plain text
    # with no URL attached.
    feedback_url_is_real = FEEDBACK_URL.startswith("https://")
    feedback_url_html = _html.escape(FEEDBACK_URL, quote=True)
    body_core_text, body_core_html = _linkify_google_review(
        body_core_text, body_core_html, feedback_url_is_real, feedback_url_html, FEEDBACK_URL,
    )
    body_core_html = _linkify_phone(body_core_html)

    # === Assemble: the (substituted) body, then the signature, then the footer ===
    body_text = f"{body_core_text}\n\n{signature_text()}"
    body_html = f"{body_core_html}\n{signature_html()}"

    body_text += compliance_footer_text()
    body_html += compliance_footer_html()

    if custom_subject is not None:
        template_subject = custom_subject
        subject = substitute_placeholders(custom_subject, placeholder_values).replace("\r", "").replace("\n", "")
    else:
        template_subject = SUBJECT
        subject = SUBJECT

    return {
        "subject": subject,
        "template_subject": template_subject,
        "template_text": raw_template,
        "body_text": body_text,
        "body_html": body_html,
    }
