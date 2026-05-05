# Donnit Build-Out Todo

Last updated: 2026-05-05

## Operating Rule

Codex is the implementation source of truth. Perplexity Computer should be used for deployed preview testing, account-console checks, and founder feedback. Avoid editing the same source files outside Codex while this build-out is active.

## Current MVP State

Shipped foundations:

- Supabase-backed auth/workspace bootstrap.
- Gmail OAuth scan into task suggestions.
- AI-style email interpretation for receipts, renewals, approvals, and follow-ups.
- Approval-before-task-creation for email suggestions.
- Calendar-aware agenda build with Google Calendar export.
- Task detail editing, completion, assignment, reassignment, delegation, and collaborators.
- Manager reporting basics.
- Workspace hamburger menu and admin/settings scaffolding.

Known operational items:

- Apply `supabase/migrations/0008_task_relationships.sql` in Supabase so delegated/collaborator fields persist as first-class columns.
- Keep `package-lock.json` line-ending noise uncommitted unless dependencies actually change.

## P0: Pilot-Critical Work Loop

1. Approval inbox
   - Open a same-window approval modal after Gmail scan creates suggestions.
   - Show every suggested task in task format: interpreted title, source, urgency, due date, rationale, and original excerpt.
   - Let manager approve, dismiss, or defer without leaving the command center.
   - Track approval rate and dismissal rate.

2. AI task extraction quality
   - Replace deterministic parsing with structured LLM extraction for chat and email.
   - Return JSON fields: title, description, urgency, due date, estimate, assignee, delegate, collaborators, confidence, and rationale.
   - Add guardrails for receipts, newsletters, FYI emails, and low-confidence messages.

3. Manager cockpit
   - Make the primary view: approval inbox, today agenda, overdue/delegated work, and assigned team work.
   - Keep chat quick-add visible, but do not let it dominate manager workflows.
   - Add clear provenance for tasks created from email, chat, manual assignment, and calendar.

4. Delegation loop
   - Add delegated task state, delegate acceptance, progress notes, and manager-visible accountability.
   - Keep delegated work on the owner's list until completion.
   - Add events for reassign, delegate, collaborate, progress, and completion.

5. Reporting metrics
   - Add accepted suggestions %, incomplete %, overdue %, average completion time, delegated outstanding, and task source mix.
   - Build manager/team filters.
   - Persist enough event timestamps to support fundraising metrics.

## P1: Integration Expansion

6. Slack ingestion
   - Add Slack OAuth/bot configuration.
   - Create task suggestions from message shortcuts, mentions, and selected channels.
   - Reuse the same approval inbox as Gmail.

7. Notifications
   - Add bell icon notification center.
   - Start with in-app due-soon, overdue, assigned-to-you, delegated-progress, and approval-waiting notifications.
   - Add browser push after notification event model is stable.

8. SMS task creation
   - Add Twilio or equivalent inbound SMS webhook.
   - Parse SMS into task suggestions and route to approval inbox.
   - Add user phone verification before accepting inbound commands.

9. Admin/team settings
   - Persist admin settings.
   - Add invite/member management.
   - Add manager/team assignment and role changes.

## P2: Fundraising Differentiators

10. Operational memory
    - Build employee/work profile pages from recurring tasks, task history, sources, and notes.
    - Add replacement/onboarding view showing recurring responsibilities and current open work.

11. Agenda intelligence
    - Add visual schedule review with drag/rebuild.
    - Account for energy blocks, meeting context, urgency, deadlines, estimates, and delegated accountability.
    - Add calendar conflict repair after export.

12. Investor/demo readiness
    - Add demo seed workspace with realistic manager/team data.
    - Add usage analytics for design partners.
    - Prepare a 5-minute founder-led demo flow: scan inbox, approve tasks, delegate, build agenda, export calendar, show report.

## Development Order

Current sprint:

1. Build approval inbox modal and open it automatically after scans.
2. Improve chat/email structured extraction.
3. Add approval metrics to reporting.
4. Implement Slack suggestion source using the same approval pipeline.
5. Add notification center foundation.

