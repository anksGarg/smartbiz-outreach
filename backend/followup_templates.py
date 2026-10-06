"""Prompt templates for the Customers follow-up drafts (POST /followup/draft).

Template-only feature: this file controls tone and content, but never sends
anything. To change tone, wording, or the suggested next job for a category,
edit _NEXT_JOB_SUGGESTION or _BASE_RULES below — nothing in main.py needs to
change.
"""

CATEGORIES = ["Re-Roofing", "Gutter Cleaning", "Pressure Washing"]

# One soft, no-pressure suggestion per category — inserted into _BASE_RULES.
_NEXT_JOB_SUGGESTION = {
    "Re-Roofing":       "a free roof check-in",
    "Gutter Cleaning":  "a seasonal gutter cleaning",
    "Pressure Washing": "an annual wash or moss prevention visit",
}

# Plain-text unsubscribe line, appended to every draft body after generation
# (not left to the model, so it's always present verbatim).
UNSUBSCRIBE_LINE = (
    "If you'd rather not hear from us again, just reply and let us know and we'll take you off our list."
)

# Supplied by the business owner — do not invent a real address here.
MAILING_ADDRESS_PLACEHOLDER = "[BUSINESS MAILING ADDRESS]"

_BASE_RULES = """\
You are writing a short follow-up email from Willamette Power Roofing, a \
roofing and gutter company in Portland, OR, to a past customer.

Rules:
- Body must be under 120 words.
- Friendly and plain-spoken, from the team — not a mass email.
- Use the customer's first name.
- Mention the specific past service and the year it was done. Never state the exact date.
- If no year of service is given, do not mention a year.
- Make exactly one soft, no-pressure suggestion: {suggestion}.
- Do NOT invent prices, discounts, offers, or guarantees.
- Do NOT invent any details about the customer's property beyond what you're given.
- Do not mention the customer's street address.
- Do NOT include an unsubscribe line or mailing address — those are added separately, after your response.
- Subject: under 8 words, plain, no all caps, no exclamation marks.
- Write as "we" (the company team), not "I". Do not claim to personally remember the customer or the job.
- End the body by inviting them to reply to this email if they'd like to set something up. Do not invent a phone number, website, or email address.
- Sign off with "Willamette Power Roofing".

Respond with strict JSON only, no markdown fencing, in exactly this shape:
{{"subject": "...", "body": "..."}}
"""

# category -> fully-rendered system prompt for that category
SYSTEM_PROMPTS = {
    category: _BASE_RULES.format(suggestion=_NEXT_JOB_SUGGESTION[category])
    for category in CATEGORIES
}
