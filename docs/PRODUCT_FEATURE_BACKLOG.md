# Donnit Product Feature Backlog

Last updated: 2026-05-13

This is the living list of product features that are not yet marked complete. When the CEO asks what product features are still left to be implemented, Codex should return this list with current status until each item is marked completed.

Status key:

- Open: not started or only conceptually scoped.
- In progress: implementation has started but is not ready to test.
- Ready to test: built and needs CEO/product validation.
- Completed: keep only briefly after completion, then move to release notes or implementation history.

## Open Features

### Product Refinement Sprint: Memory, Intelligence, UI

Status: In progress

Goal: Strengthen Donnit around the three product weaknesses identified on 2026-05-14 before customer onboarding:

1. Durable role memory and learning: Position Profiles need a source-backed, searchable, editable memory system that survives employee transitions and can be read by Donnit AI.
2. Chat and automation intelligence: Chat, email, Slack, SMS, and assistant workflows need better interpretation, clarification, and role-aware responses comparable to modern AI work platforms.
3. UI simplification: The command center, admin portal, and Position Profiles need less clutter, clearer navigation, and sharper first-use paths.

Current focus:

- Build a cloud-backed Position Profile memory vault using Supabase `position_profile_knowledge`, inspired by Obsidian's durable Markdown-file model but workspace-scoped and transition-safe.
- Make Donnit AI read from this durable role memory when drafting task updates or handoff intelligence.
- Build the workspace task-resolution layer documented in `docs/intelligence/task-resolution-memory-architecture.md`: entity memory, relationship memory, alias memory, session memory, procedural memory, bounded candidate retrieval, confidence scoring, clarification merge, and correction-to-memory learning.
- Active recurring-work direction: **Task Memory**. Donnit should preserve repeatable role responsibilities as position-scoped task sequences with timing, instructions, systems, expected outputs, and learned changes, so a new profile holder can complete one clear step at a time without relearning the whole process.

Next implementation sequence:

1. Expand the task-intelligence eval set around aliases, roles, recurring work, vague times, corrections, and session follow-ups. First pass is implemented for member/profile alias routing and ambiguity.
2. Add workspace alias memory for people, Position Profiles, departments, recurring artifacts, and task-template triggers.
3. Build a shared task-resolution context provider that retrieves bounded candidate sets before the LLM resolves the input.
4. Add staged retrieval and margin-aware ranking: exact alias/name first, structured fuzzy second, semantic/vector fallback later, then confidence based on the gap between top and runner-up candidates. First deterministic member/profile version is implemented.
5. Replace ad hoc chat extraction with a structured resolution contract that returns confidence, inferred fields, gaps, and one clarifying question.
6. Persist pending task drafts so follow-up answers update the existing task instead of creating malformed new tasks.
7. Log user corrections and accepted inferences back into workspace or Position Profile memory.
8. Add contested alias handling and alias decay so ambiguous or stale aliases ask instead of auto-writing.

### Agentic AI Assistant

Status: In progress

Goal: Add a Donnit AI assistant that can be assigned work by a user, complete bounded tasks through approved tools, report back, and update the related task profile with what it did, what it found, and what still needs human action.

Roadmap: See `docs/AGENTIC_AI_ASSISTANT_ROADMAP.md`.

Core workflow:

1. User assigns a task to Donnit AI from chat with `/donnit`, a task detail view, or a future assistant command surface.
2. Donnit AI clarifies missing requirements before starting if the task is ambiguous, risky, or requires credentials/tool access.
3. Donnit AI creates an execution plan and asks for confirmation before any write/send action.
4. Donnit AI performs approved read actions autonomously, such as reviewing task history, searching role memory, checking email context, checking calendar availability, summarizing attachments, or drafting a response.
5. Donnit AI performs write actions only after explicit approval, such as sending an email, creating subtasks, updating a task, creating a calendar hold, or notifying another person.
6. Donnit AI reports back in the task with summary, evidence, actions taken, blockers, and recommended next step.
7. Donnit AI updates the Position Profile/task memory when the work teaches Donnit how the role operates.

MVP scope:

- Start with one bounded assistant skill: "Research and draft a task update." Backend foundation is implemented behind `POST /api/tasks/:id/assistant-runs`; `/donnit` command routing from chat is ready to test.
- The assistant may read the task, subtasks, notes, completion history, Position Profile memory, relevant email suggestion text, and existing attachments if available.
- The assistant may produce a draft response, task summary, checklist, or recommended subtasks.
- The assistant may not send external messages or mutate workspace state without confirmation.
- The first `/donnit` experience creates the task through the normal chat parser, starts the internal read-only Donnit AI task-update assistant, writes the result to the task log, and triggers a bell notification. Learned workflow matching remains future scope.

Future scope:

- Tool execution through approved providers such as Gmail, Google Calendar, Slack, and Composio.
- Voice-to-task through Wispr/Whisper Flow or native mobile dictation, routed into the same chat command parser.
- Learned workflow recognition, potentially powered by Hermes skill/procedural memory behind Donnit's own permission layer.
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

### Position Profile Switching

Status: Open

Goal: Each person must have exactly one primary Position Profile, but may receive delegated or temporary access to multiple additional profiles. Donnit should provide a clear profile switcher so users can choose which profile context they are viewing, assigning work under, or adding Task Memory to.

Notes:

- Add after the first Task Memory quick-key workflow is validated.
- The switcher should default to the user's primary profile.
- Delegated profiles should be visibly separate from the user's primary profile.
- Chat/task creation should use the primary profile unless the user explicitly switches context or the task is clearly tied to a delegated profile.

Open questions:

- Which first assistant skill should ship first for customer value: draft task update, draft handover packet, research from email/task history, or agenda repair?
- Should Donnit AI appear as a user/member in task assignment, or as a task action called "Ask Donnit"?
- What actions should be allowed during the first customer onboarding on Friday?

## Completed Features

None in this backlog yet.
