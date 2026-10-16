"""Deterministic follow-up email template (POST /followup/draft).

No AI call — render_followup_email() builds the subject/body_text/body_html
directly from fixed copy below, with a few conditional sections and fill-ins.
Edit the paragraph strings inside render_followup_email() (or the constants
below) to change wording; nothing else in main.py needs to change.
"""

from __future__ import annotations

import html as _html
import re as _re

CATEGORIES = ["Re-Roofing", "Gutter Cleaning", "Pressure Washing"]

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

# Owner has not supplied real copy for this yet — placeholder, do not invent a value.
# FEEDBACK_URL only becomes a clickable link once it's a real https:// URL.
FEEDBACK_URL = "[GOOGLE REVIEW LINK]"

# Literal default values for the placeholders above — used by is_live_ready()
# to detect whether the owner has actually supplied real copy yet. SUBJECT is
# no longer one of these: it's owner-approved fixed copy, not a placeholder.
_DEFAULT_MAILING_ADDRESS_PLACEHOLDER = "[BUSINESS MAILING ADDRESS]"
_DEFAULT_FEEDBACK_URL = "[GOOGLE REVIEW LINK]"


def is_live_ready() -> bool:
    """True only once every placeholder above has been replaced with real
    copy AND the compliance footer has been turned on. Used to gate live
    (non-test) sending in /followup/send — see main.py."""
    return (
        INCLUDE_COMPLIANCE_FOOTER
        and MAILING_ADDRESS_PLACEHOLDER != _DEFAULT_MAILING_ADDRESS_PLACEHOLDER
        and FEEDBACK_URL != _DEFAULT_FEEDBACK_URL
    )

_PHONE = "503-410-6919"
_EMAIL = "info@willametteroof.com"
_WEBSITE = "www.willametteroof.com"
_WEBSITE_URL = "https://www.willametteroof.com"

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


def render_followup_email(
    name: str = "",
    last_service: str = "",
    last_service_date: str = "",
    has_reroofing: bool = False,
    reroofing_last_date: str = "",
    business_signal: bool = False,
    template: str | None = None,
) -> dict:
    """Build {subject, body_text, body_html} for one customer. Pure function —
    no network, no file I/O, no Sheets access.

    template ("with_reroofing" | "without_reroofing") controls ONLY whether
    Section B (the roof-replacement pitch) appears — it is independent of the
    customer's real has_reroofing/reroofing_last_date history, which always
    still drives the "{service} in {year}" sentence. Any other/missing value
    falls back to the historical default: with_reroofing if has_reroofing
    else without_reroofing (this is what /followup/draft relies on).
    """
    if template not in ("with_reroofing", "without_reroofing"):
        template = "with_reroofing" if has_reroofing else "without_reroofing"
    show_section_b = template == "without_reroofing"

    first_name = "there" if business_signal else _first_name(name)

    if has_reroofing:
        service = "re-roofing"
        year = _year_of(reroofing_last_date)
    else:
        service = (last_service or "").strip().lower()
        year = _year_of(last_service_date)

    service_phrase = f"{service} in {year}" if year else service
    service_sentence = f"your {service_phrase}"

    # FEEDBACK_URL only becomes a clickable link / gets appended once it's a
    # real https:// URL — while it's still the bracketed placeholder, the
    # review ask stays plain text with no URL attached.
    feedback_url_is_real = FEEDBACK_URL.startswith("https://")

    review_sentence_text = "Thanks again for your business. If you have a minute, please leave us a Google review."
    if feedback_url_is_real:
        review_sentence_text += f" {FEEDBACK_URL}"

    # === Plain text ===
    lines = [
        f"Hi {first_name},",
        "",
        f"It's Gus and Ajay from Willamette Power Roofing. Thank you for trusting us with {service_sentence}. "
        "We don't take that lightly.",
        "",
        "With the rainy season close, now is a good time to clear moss and flush gutters before the first "
        "big storm. We can help with roof cleaning and moss treatment, gutter and downspout flushing, and "
        "new gutters if yours are sagging or undersized.",
        "",
    ]
    if show_section_b:
        lines.append(
            "If you've been wondering how much life your roof has left, let's talk about it before it "
            "starts leaking — plan the timing on your terms, not the weather's. If you go ahead, it "
            "comes with a 50-year non-prorated warranty and our 15-year workmanship warranty."
        )
        lines.append("")
    lines.extend([
        "We'll start with a free inspection of your roof and gutters, so you know exactly what you need. "
        f"Just reply to this email or call/text {_PHONE}.",
        "",
        review_sentence_text,
        "",
        "Regards,",
        "Gus and Ajay",
        "Owners, Willamette Power Roofing",
        f"{_PHONE} | {_EMAIL} | {_WEBSITE}",
        "CCB 260629 · WA WPRLLL*747CQ · Licensed, Bonded & Insured",
    ])
    body_text = "\n".join(lines)

    # === HTML (escape any customer-supplied text) ===
    fn_html = _html.escape(first_name)
    service_phrase_html = _html.escape(service_phrase)
    service_sentence_html = f"your {service_phrase_html}"
    feedback_url_html = _html.escape(FEEDBACK_URL, quote=True)

    if feedback_url_is_real:
        review_sentence_html = (
            "Thanks again for your business. If you have a minute, please leave us a "
            f'<a href="{feedback_url_html}">Google review</a>.'
        )
    else:
        review_sentence_html = (
            "Thanks again for your business. If you have a minute, please leave us a Google review."
        )

    html_parts = [
        f"<p>Hi {fn_html},</p>",
        f"<p>It's Gus and Ajay from Willamette Power Roofing. Thank you for trusting us with "
        f"{service_sentence_html}. We don't take that lightly.</p>",
        "<p>With the rainy season close, now is a good time to clear moss and flush gutters before the "
        "first big storm. We can help with roof cleaning and moss treatment, gutter and downspout "
        "flushing, and new gutters if yours are sagging or undersized.</p>",
    ]
    if show_section_b:
        html_parts.append(
            "<p>If you've been wondering how much life your roof has left, let's talk about it before it "
            "starts leaking — plan the timing on your terms, not the weather's. If you go ahead, it "
            "comes with a 50-year non-prorated warranty and our 15-year workmanship warranty.</p>"
        )
    html_parts.extend([
        "<p>We'll start with a free inspection of your roof and gutters, so you know exactly what you "
        f'need. Just reply to this email or call/text <a href="tel:{_PHONE}">{_PHONE}</a>.</p>',
        f"<p>{review_sentence_html}</p>",
        "<p>Regards,<br>"
        "Gus and Ajay<br>"
        "Owners, Willamette Power Roofing<br>"
        f'<a href="tel:{_PHONE}">{_PHONE}</a> | '
        f'<a href="mailto:{_EMAIL}">{_EMAIL}</a> | '
        f'<a href="{_WEBSITE_URL}">{_WEBSITE}</a><br>'
        "CCB 260629 · WA WPRLLL*747CQ · Licensed, Bonded &amp; Insured</p>",
    ])
    body_html = "\n".join(html_parts)

    if INCLUDE_COMPLIANCE_FOOTER:
        body_text += f"\n\n{UNSUBSCRIBE_LINE}\n{MAILING_ADDRESS_PLACEHOLDER}"
        body_html += f"<p>{_html.escape(UNSUBSCRIBE_LINE)}<br>{_html.escape(MAILING_ADDRESS_PLACEHOLDER)}</p>"

    return {"subject": SUBJECT, "body_text": body_text, "body_html": body_html}
