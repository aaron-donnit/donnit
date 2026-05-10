# Donnit Product Lead MVP Execution Plan

Last updated: 2026-05-07

## Operating Cadence

This is the CEO-approved product execution list from this point forward. Each step is treated as one product milestone:

1. Codex implements the milestone.
2. Codex validates the build.
3. Codex presents the milestone to the CEO for approval.
4. After approval, Codex moves to the next milestone automatically.

Outside tool integrations are intentionally moved to Step 7 so the core product is stable before deeper provider work.

## Step 1: Stabilize the Daily Work Surface

Goal: make Donnit feel calm, obvious, and reliable for a manager using it every day.

Actions:

- Keep Chat to task visible as the fastest capture path.
- Make the task list the dominant work area.
- Collapse supporting panels into a focused command rail: Today, Agenda, Team, Reports.
- Keep secondary settings, sync, logs, and admin functions out of the main line of sight.
- Ensure panels do not overflow the viewport and dialogs remain internally scrollable.

CEO approval criteria:

- A manager can understand the main page in under 10 seconds.
- The visible workflow is capture, approve, work, schedule.
- The screen does not feel like a long settings document.

## Step 2: Make Position Profiles the Flagship Feature

Goal: turn Position Profiles into Donnit's strongest workforce continuity product, not just a derived prototype view.

Actions:

- Build an admin-only Position Profile repository by job title.
- Add create, rename, assign, reassign, delegate coverage, vacancy mode, and archive controls.
- Show current incomplete work, recurring responsibilities, recurring cadence, how-to memory, source evidence, and role risk.
- Add a transition checklist that pulls current tasks, recurring work, access needs, active collaborators, and open deadlines.
- Add manager/admin review controls before high-impact knowledge changes are committed.

CEO approval criteria:

- Admin can open a job-title profile and understand what the role owns.
- Admin can temporarily cover a vacant role without mixing it with their own profile.
- A replacement employee can inherit only the assigned position profile.

## Step 3: Persist Serious Work Data

Goal: remove prototype-only state from business-critical workflows.

Actions:

- Persist subtasks, task notes, agenda approvals, notification review state, task source metadata, profile assignments, and profile knowledge to Supabase.
- Add migrations and server APIs for each durable workflow.
- Keep localStorage only for harmless view preferences.

CEO approval criteria:

- Refreshing, switching devices, or changing users does not lose meaningful task or profile data.
- Manager-visible information is shared and auditable.

## Step 4: Improve AI Task Interpretation and Trust

Goal: make every AI-created task feel useful, editable, and explainable.

Actions:

- Improve structured extraction for chat, email, SMS, Slack, and document text.
- Always return clean title, description, owner, due date, urgency, estimated time, source, confidence, and rationale.
- Add source excerpts and "why Donnit suggested this" to approval cards.
- Add a feedback loop so user corrections improve future suggestions.

CEO approval criteria:

- AI output reads like a task a professional would write.
- Donnit separates "someone asked me to do this" from "this is just context or a receipt."
- Users can quickly approve, edit, or dismiss without losing trust.

## Step 5: Build the Manager Dashboard

Goal: give managers useful visibility without turning Donnit into surveillance software.

Actions:

- Build a manager Team view with people, overdue work, current workload, completed work, delegated work, and open risk.
- Add timeframe filters and drilldowns into task notes and progress.
- Add source mix and AI approval metrics by team.
- Keep language focused on work continuity and support, not employee monitoring.

CEO approval criteria:

- A manager can answer "what needs attention today?" without asking every team member.
- Team visibility feels operationally helpful, not punitive.

Implementation status:

- Moved manager reporting out of the main support rail and into a permission-gated manager/admin report action.
- Kept daily work UI focused on Today, Agenda, and Team.
- Added backlog item: completed-task log entries should open the full task detail view when the viewer owns the task, inherited it through a Position Profile, manages the owner, or is an admin.

## Step 6: Finish Agenda Intelligence

Goal: make Donnit's daily agenda useful enough to become a repeated habit.

Actions:

- Add agenda preferences: work hours, focus blocks, lunch, minimum block size, meeting buffer, and preferred task types by time of day.
- Let users approve, remove, reorder, or rebuild agenda blocks.
- Detect calendar conflicts and repair schedule blocks before export.
- Create a dedicated agenda work screen.

CEO approval criteria:

- Agenda output feels like a real day plan, not just a sorted to-do list.
- Calendar export creates timed events unless the task is truly all-day.

Implementation status:

- Added persistent agenda preferences and manual ordering.
- Added approval-safe remove/reorder controls before export.
- Updated calendar export to use the approved agenda preferences and task order.
- Added an agenda work screen with an up-next block and task progress context.

## Step 7: Complete Outside Tool Integrations Individually

Goal: make automatic capture reliable after the core work loop is trustworthy.

Order:

1. Gmail and Google Calendar production hardening.
2. Slack OAuth, bot events, user mapping, unread-delay suggestion logic.
3. SMS inbound task creation with verified phone routing.
4. Email/Slack/SMS outbound reply actions from Donnit.
5. Future tools: Teams, Outlook, Drive, and credential/access vault integrations.

CEO approval criteria:

- Each integration has a clear connect flow, health state, failure message, and disconnect path.
- Automatic suggestions enter the same approval inbox.
- Source mix reporting proves which tools are creating value.

Step 7.1 implementation status:

- Extended Google OAuth health reporting with Gmail scope, Calendar scope, token expiry, and typed health state.
- Added Gmail and Google Calendar reconnect/disconnect controls to Workspace settings.
- Refreshed integration status after Gmail scan, calendar export, and disconnect events.

Step 7.2 implementation status:

- Added Slack integration health metadata for webhook token, signing secret, bot token, Events API endpoint, user mapping, and unread delay.
- Added `/api/integrations/slack/events` for Slack URL verification and user-message event ingestion.
- Added Slack signature/token verification, best-effort Slack user lookup, workspace member assignment mapping, and idempotent suggestion keys.
- Surfaced Slack event bridge and user mapping status in Workspace settings.

Step 7.3 implementation status:

- Added SMS integration health metadata for ingest token, Twilio signature verification, account/from-number config, inbound endpoint, and routing mode.
- Added `/api/integrations/sms/status`.
- Hardened `/api/integrations/sms/inbound` to accept either Donnit JSON payloads or Twilio form webhooks (`Body`, `From`, `To`, `MessageSid`).
- Added optional Twilio signature verification and configurable default assignee routing.
- Surfaced SMS inbound bridge and routing status in Workspace settings.

Step 7.4 implementation status:

- Added provider-aware outbound replies from approval suggestions.
- Email replies open a prefilled mail draft without requiring expanded Gmail send permissions.
- Slack replies send through `SLACK_BOT_TOKEN` when a source channel is available, with copy fallback.
- SMS replies send through Twilio when `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` are configured, with copy fallback.
- Reused the approval inbox Reply popup so users can answer source messages without leaving the Donnit workflow.

## Step 8: Onboarding and Pilot Readiness

Goal: make the product usable by design partners with less founder explanation.

Actions:

- Add first-login setup: connect tools, invite team, create first position profile, send first chat-to-task entry.
- Add demo workspace seed data.
- Add pilot analytics: tasks captured, suggestions approved, suggestions dismissed, agenda usage, overdue reduction, role-profile usefulness.
- Add trust pages and basic security posture for buyers.

CEO approval criteria:

- A design partner can reach first value in one session.
- We can measure whether Donnit is creating real behavior change.

Step 8.1 implementation status:

- Added a non-blocking first-value onboarding checklist to the workspace.
- Checklist drives users through Google connection, first task capture, approval review, agenda creation, and Position Profile confirmation.
- Added a hamburger menu action to reopen the setup checklist after dismissal.
- Added durable onboarding dismissal state in `donnit.user_workspace_state`.
- Added migration `20260508164500_onboarding_workspace_state.sql` to allow `onboarding_state` persistence.

Step 8.2 implementation status:

- Added a Pilot Analytics section to Reports.
- Tracks captured work volume, AI approval quality, automation/source share, work health, agenda habit, and continuity coverage.
- Surfaces pilot risks such as pending approvals, overdue work, delegated accountability, and high-risk Position Profiles.
- Keeps the metrics framed around behavior change and workforce continuity, not employee surveillance.

Step 8.3 implementation status:

- Expanded the demo seed into a buyer-ready pilot workspace.
- Seed now creates sample team members, realistic open/completed tasks, subtasks, pending approval suggestions, and Position Profiles.
- Added an admin menu action to seed the demo workspace even when team members already exist.
- Demo data is idempotent so rerunning the action refreshes missing pieces without duplicating existing sample records.
- Added an in-app Demo workspace guide that explains the demo data lives in the active workspace and links directly to Team, Approvals, Reports, and Position Profiles.
