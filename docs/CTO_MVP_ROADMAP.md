# Donnit MVP Roadmap

Last updated: 2026-05-04

## CTO Priority

The MVP must prove one thesis: managers can capture, assign, prioritize, and verify work faster than they can in email, chat, spreadsheets, or generic task tools.

## P0: Core Work System

Ship before go-to-market pilots.

- AI-assisted chat-to-task parsing.
- Email-to-task suggestions with approval before task creation.
- Task detail view with notes, status, urgency, due date, assignee, and estimate editing.
- Delegated task tracking: assigned-by remains accountable until completion.
- Manager reporting: incomplete %, overdue count, average completion time, delegated outstanding.
- Admin/manager/member roles with manager-owned teams.
- Notification center for due soon and past due tasks.

## P1: Integrations

Ship after core work system is stable.

- Gmail scanning in production after Gmail API is enabled and OAuth verification posture is clear.
- Slack ingestion through bot events or message shortcuts.
- Calendar read/write: read meetings/availability, write suggested agenda blocks.
- Push notifications through browser PWA.
- SMS task creation through a provider such as Twilio.

## P2: AI Orchestration

Ship after reliable task state exists.

- LLM-based extraction from chat/email/Slack with structured JSON output.
- Human approval modal for every scraped task suggestion.
- AI daily agenda planner using availability, due dates, urgency, estimated duration, and delegated accountability.
- Manager summary/report generation.

## Current Functional Audit

- Auth and workspace bootstrap: partially working.
- Chat task creation: deterministic parser exists; AI parser not yet wired.
- Gmail OAuth: wired, but Google Cloud Gmail API must be enabled.
- Email suggestions: Gmail/manual queue exists with approval flow.
- Task assignment: basic assignment exists; detailed edit flow in progress.
- Calendar export: `.ics` agenda export exists; calendar read/write not yet integrated.
- Reporting: foundational manager metrics in progress.
- Notifications: reminder metadata exists; bell/push delivery not yet built.
- SMS: not started.
- Slack: not started.
- Admin settings: data model has roles; admin UI not yet built.

## Go-To-Market MVP Definition

A pilot-ready MVP should let a manager:

1. Sign in and create a workspace.
2. Invite or at least represent team members.
3. Add work by chat, manual assignment, and Gmail scan.
4. Approve suggested tasks before they enter the list.
5. Delegate tasks and track them until completion.
6. Edit task details as reality changes.
7. See reporting on overdue, incomplete, completion time, and delegated work.
8. Export a daily agenda to calendar.

Slack, SMS, push, and AI calendar scheduling are important, but they should not block the first pilot if the core management loop is strong.
