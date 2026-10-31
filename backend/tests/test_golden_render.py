"""Default follow-up output must match what the PRE-editable renderer produced
(fixtures/golden_followup.json, captured by generate_golden_fixture.py from
dev at 604ca14). The only accepted difference: apostrophes in body_html are now
escaped as &#x27; — identical once rendered."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import followup_templates as ft

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "golden_followup.json").read_text())
CASES = FIXTURE["cases"]


def _normalize_html(html: str) -> str:
    return html.replace("&#x27;", "'")


def _apply_config(monkeypatch, name: str) -> None:
    for key, value in FIXTURE["configs"][name].items():
        monkeypatch.setattr(ft, key, value)


def _case_id(case) -> str:
    inputs = case["inputs"]
    return f"{case['config']}-{inputs['template']}-{inputs['name'] or '(blank)'}"


def test_fixture_covers_both_templates_and_all_configs():
    assert {c["inputs"]["template"] for c in CASES} == {"with_reroofing", "without_reroofing"}
    assert {c["config"] for c in CASES} == set(FIXTURE["configs"])
    assert len(CASES) >= 40


@pytest.mark.parametrize("case", CASES, ids=_case_id)
def test_default_render_matches_old_renderer(case, monkeypatch):
    _apply_config(monkeypatch, case["config"])
    out = ft.render_followup_email(**case["inputs"])
    expected = case["expected"]
    assert out["subject"] == expected["subject"]
    assert out["body_text"] == expected["body_text"]
    assert _normalize_html(out["body_html"]) == _normalize_html(expected["body_html"])


@pytest.mark.parametrize("case", [c for c in CASES if c["config"] == "default"], ids=_case_id)
def test_draft_endpoint_matches_old_renderer(case, client):
    resp = client.post("/followup/draft", json=case["inputs"])
    assert resp.status_code == 200
    body = resp.json()
    expected = case["expected"]
    assert body["subject"] == expected["subject"]
    assert body["body_text"] == expected["body_text"]
    assert _normalize_html(body["body_html"]) == _normalize_html(expected["body_html"])
