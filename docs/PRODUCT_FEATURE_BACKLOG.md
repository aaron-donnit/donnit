# Donnit Product Feature Backlog

Last updated: 2026-05-13

This is the living list of product features that are not yet marked complete. When the CEO asks what product features are still left to be implemented, Codex should return this list with current status until each item is marked completed.

Status key:

- Open: not started or only conceptually scoped.
- In progress: implementation has started but is not ready to test.
- Ready to test: built and needs CEO/product validation.
- Completed: keep only briefly after completion, then move to release notes or implementation history.

## Open Features

### Agentic AI Assistant

Status: In progress

Goal: Add a Donnit AI assistant that can be assigned work by a user, complete bounded tasks through approved tools, report back, and update the related task profile with what it did, what it found, and what still needs human action.

Roadmap: See `docs/AGENTIC_AI_ASSISTANT_ROADMAP.md`.

Core workflow:

1. User assigns a task to Donnit AI from chat, a task detail view, or a future assistant command surface.
2. Donnit AI clarifies missing requirements before starting if the task is ambiguous, risky, or requires credentials/tool access.
3. Donnit AI creates an execution plan and asks for confirmation before any write/send action.
4. Donnit AI performs approved read actions autonomously, such as reviewing task history, searching role memory, checking email context, checking calendar availability, summarizing attachments, or drafting a response.
5. Donnit AI performs write actions only after explicit approval, such as sending an email, creating subtasks, updating a task, creating a calendar hold, or notifying another person.
6. Donnit AI reports back in the task with summary, evidence, actions taken, blockers, and recommended next step.
7. Donnit AI updates the Position Profile/task memory when the work teaches Donnit how the role operates.

MVP scope:

- Start with one bounded assistant skill: "Research and draft a task update." Backend foundation is implemented behind `POST /api/tasks/:id/assistant-runs`; UI entry point is still pending.
- The assistant may read the task, subtasks, notes, completion history, Position Profile memory, relevant email suggestion text, and existing attachments if available.
- The assistant may produce a draft response, task summary, checklist, or recommended subtasks.
- The assistant may not send external messages or mutate workspace state without confirmation.

Future scope:

- Tool execution through approved providers such as Gmail, Google Calendar, Slack, and Composio.
- Assistant-owned task status: assigned to Donnit, in progress, blocked, needs approval, completed.
- Background runs with notifications when the assistant finishes.
- Workspace-level assistant memory scoped by organization and Position Profile.
- Manager/admin audit log of assistant actions, cost, tools used, and approvals.

Product requirements:

- Must be workspace-scoped. Each customer workspace has separate memory, permissions, tools, and logs.
- Must be role-aware. Assistant work should update the Position Profile when it captures repeatable role knowledge.
- Must be permission-gated. External sends, task mutations, and profile memory writes require confirmation in v1.
- Must be observable. Log model, cost, tool calls, inputs/outputs summary, latency, and correlation ID.
- Must have a kill switch or feature flag per workspace.

Open questions:

- Which first assistant skill should ship first for customer value: draft task update, draft handover packet, research from email/task history, or agenda repair?
- Should Donnit AI appear as a user/member in task assignment, or as a task action called "Ask Donnit"?
- What actions should be allowed during the first customer onboarding on Friday?

## Completed Features

None in this backlog yet.
