# SmallBizOutreach

## What this is
An AI-powered lead generation and outreach tool for roofing and gutter businesses.
Built for 2 co-owners of a roofing company in Portland, OR as a design partner MVP.

## Stack
- Frontend: React + Tailwind CSS
- Backend: Python + FastAPI
- Database: JSON files stored locally (human-readable, no server needed)
- Hosting: Runs locally for MVP; Railway when ready to publish
- Key APIs: Google Solar API, BizData, Apollo.io, Claude API, Brevo

## Data storage
- contacts.json — all property contacts and leads
- customers.json — past customers for follow-up
- campaigns.json — outreach campaigns and send history

## Key rules
- Keep it simple — this is for 2 non-technical users
- Handle all API errors gracefully; never crash on a missing contact field
- Residential contacts: email only, no SMS (TCPA compliance)
- Always log sends to campaigns.json

## Build order
Currently on Session 1 — project setup

## Git workflow" 
- Never commit or push directly to main. main is production and only changes via a reviewed Pull Request from dev.
- Before any commit or push, run `git branch --show-current` and tell me the branch.
- Default working branch is dev. For larger or risky work, create feature/<module>-<description> off dev.
- Use `git add <specific files>`, never `git add .` or `git add -A`.
- Never commit data files (CSV, XLSX, ZIP, timesheets, flyers, images) or secrets.
- If a change needs a new environment variable or a Google Sheet column, list it explicitly in your summary so I can apply it to production before merging.
Commit this to dev only.
