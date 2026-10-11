# SmallBizOutreach

## What this is
An AI-powered lead generation and outreach tool for roofing and gutter businesses.
Built for 2 co-owners of a roofing company in Portland, OR as a design partner MVP.

## Stack
- Frontend: React + Tailwind CSS
- Backend: Python + FastAPI
- Database: Google Sheets (employees, timesheets) plus local JSON files (contacts, campaigns)
- Hosting: Render — a backend web service and a separate frontend static site, plus dev equivalents of each. Production uses the `main` branch; dev uses `dev`.
- Key APIs: Google Solar API, BatchData, Apollo.io, Claude API, Brevo

## Data storage
- Employee and timesheet data live in Google Sheets (Employees and Timesheets tabs).
- contacts.json — all property contacts and leads (local JSON, backend/data)
- campaigns.json — outreach campaigns and send history (local JSON, backend/data)

## Key rules
- Keep it simple — this is for 2 non-technical users
- Handle all API errors gracefully; never crash on a missing contact field
- Residential contacts: email only, no SMS (TCPA compliance)
- Always log sends to campaigns.json

## Build order
See 09_backlog.md (in the Small Business Workflow project folder) for current status and next steps.

## Git workflow
- Never commit or push directly to main. main is production and only changes via a reviewed Pull Request from dev.
- Before any commit or push, run `git branch --show-current` and tell me the branch.
- Default working branch is dev. For larger or risky work, create feature/<module>-<description> off dev.
- Use `git add <specific files>`, never `git add .` or `git add -A`.
- Never commit data files (CSV, XLSX, ZIP, timesheets, flyers, images) or secrets.
- If a change needs a new environment variable or a Google Sheet column, list it explicitly in your summary so I can apply it to production before merging.

## Documentation
- Requirements and system design docs are `10_requirements.md` and `11_system_design.md`. They currently live in the Small Business Workflow project folder, outside this repo — they will be moved into docs/ later.
- Any change to an endpoint, env var, sheet column, scoring rule, or crew-visible behavior must update those two docs in the same change, and your summary must list which doc sections changed.
- FastAPI's /docs page is the source of truth for request/response shapes.
- If you are unsure whether the docs are still accurate, say so instead of guessing.
