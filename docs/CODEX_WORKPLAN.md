# Donnit Codex Workplan

Last updated: 2026-05-04

## Working Rule

Codex is the source of truth for code changes. Perplexity Computer is used for viewing deployed previews, Vercel/Supabase/Google console checks, and outside research. Do not edit the same code in both places at the same time.

Use this handoff format when moving between tools:

```text
Current branch:
Current goal:
What changed:
What still needs checking:
Any blocker:
Next Codex task:
```

## Branch 1: codex-security-foundation

Goal: make the current app safer to show, test, and deploy before adding larger product workflows.

Changes in progress:

- Restrict detailed health diagnostics in production behind `DONNIT_HEALTH_TOKEN`.
- Stop exposing detailed entry/commit health metadata publicly in production.
- Sanitize unauthenticated demo bootstrap data.
- Add production security headers.
- Disable Express `X-Powered-By`.
- Prevent the service worker from returning the app shell for failed `/api/*` requests.
- Hide debug/manual import and disabled roadmap buttons in production.

Validation:

- `npm.cmd run check`
- `npm.cmd run build`

## Branch 2: codex-trust-pages

Goal: add the public trust layer needed before asking users to connect Gmail or manage employee tasks.

Planned pages:

- Privacy
- Terms
- Security
- Data deletion
- OAuth/Gmail disclosure

## Branch 3: codex-manager-workflows

Goal: sharpen Donnit around the strongest product wedge: manager work continuity.

Planned product work:

- Manager dashboard for assigned, overdue, blocked, and completed work.
- Employee task profiles.
- Recurring task memory.
- Replacement/onboarding view.
- Assignment approval and completion history improvements.

## Fundraising Readiness

Do not position Donnit as a generic AI task manager. Position it as a manager-facing work continuity system that captures recurring work, assigns tasks, tracks completion, and shortens employee handoff/onboarding time.

Evidence to collect before fundraising:

- Tasks captured per manager per week.
- False-positive rate for email/chat task suggestions.
- Completion-rate lift.
- Overdue-work reduction.
- Manager hours saved.
- Replacement/onboarding ramp-time reduction.
