"""Regenerate fixtures/golden_followup.json from the PRE-editable-template
renderer (dev at 604ca14), NOT from the current code — so test_golden_render.py
proves the default output didn't change. Synthetic customers only.

Run from the repo root:  python3 -I backend/tests/generate_golden_fixture.py
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path

OLD_REF = "604ca14"
HERE = Path(__file__).resolve().parent
OUT = HERE / "fixtures" / "golden_followup.json"

# Synthetic names only — chosen to hit each _first_name() branch.
CUSTOMERS = [
    {"name": "Jordan Testerson", "last_service": "Gutter Cleaning", "last_service_date": "2023-04-12",
     "has_reroofing": False, "reroofing_last_date": "", "business_signal": False},
    {"name": "Dr. Casey Example", "last_service": "Pressure Washing", "last_service_date": "6/30/2022",
     "has_reroofing": False, "reroofing_last_date": "", "business_signal": False},
    {"name": "EXAMPLE, RILEY", "last_service": "Re-Roofing", "last_service_date": "",
     "has_reroofing": True, "reroofing_last_date": "2019-09-01", "business_signal": False},
    {"name": "Sample Holdings LLC", "last_service": "Gutter Cleaning", "last_service_date": "2024",
     "has_reroofing": False, "reroofing_last_date": "", "business_signal": False},
    {"name": "Avery & Quinn Placeholder", "last_service": "Re-Roofing", "last_service_date": "2018-02-02",
     "has_reroofing": True, "reroofing_last_date": "2018-02-02", "business_signal": False},
    {"name": "morgan o'fakename", "last_service": "Pressure Washing", "last_service_date": "not a date",
     "has_reroofing": False, "reroofing_last_date": "", "business_signal": True},
    {"name": "Renée Ficticia", "last_service": "Gutter Cleaning", "last_service_date": "",
     "has_reroofing": False, "reroofing_last_date": "", "business_signal": False},
    {"name": "", "last_service": "Re-Roofing", "last_service_date": "2021-07-07",
     "has_reroofing": False, "reroofing_last_date": "", "business_signal": False},
]

TEMPLATES = ["with_reroofing", "without_reroofing"]

# Module-constant overrides applied to the renderer before each render.
CONFIGS = {
    "default": {},
    "real_feedback_url": {"FEEDBACK_URL": "https://example.com/review"},
    "full_footer": {
        "INCLUDE_COMPLIANCE_FOOTER": True,
        "MAILING_ADDRESS_PLACEHOLDER": "100 Example Ave, Portland, OR 97200",
        "FEEDBACK_URL": "https://example.com/review",
    },
}


def _load_old_renderer(tmp: Path):
    src = subprocess.run(
        ["git", "show", f"{OLD_REF}:backend/followup_templates.py"],
        check=True, capture_output=True, text=True, cwd=HERE,
    ).stdout
    path = tmp / "followup_templates_old.py"
    path.write_text(src)
    spec = importlib.util.spec_from_file_location("followup_templates_old", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        old = _load_old_renderer(Path(tmp))
        baseline = {k: getattr(old, k) for k in ("FEEDBACK_URL", "INCLUDE_COMPLIANCE_FOOTER", "MAILING_ADDRESS_PLACEHOLDER")}
        cases = []
        for config_name, overrides in CONFIGS.items():
            for key, value in {**baseline, **overrides}.items():
                setattr(old, key, value)
            for customer in CUSTOMERS:
                for template in TEMPLATES:
                    out = old.render_followup_email(**customer, template=template)
                    cases.append({
                        "config": config_name,
                        "inputs": {**customer, "template": template},
                        "expected": {k: out[k] for k in ("subject", "body_text", "body_html")},
                    })
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({"source": f"git show {OLD_REF}:backend/followup_templates.py",
                               "configs": CONFIGS, "cases": cases}, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {len(cases)} cases to {OUT.relative_to(HERE.parent.parent)}", file=sys.stderr)


if __name__ == "__main__":
    main()
