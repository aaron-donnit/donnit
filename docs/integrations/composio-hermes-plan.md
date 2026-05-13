# Donnit Composio + Hermes Implementation Plan

Date: 2026-05-12

## Product Goal

Donnit should feel like a simple workspace command center while the backend does the hard work: read workplace signals, reason over role-specific context, ask only useful clarification questions, and take tool actions only after user confirmation. Every customer's intelligence must be isolated by workspace.

## Architecture Decision

- Composio becomes Donnit's governed external tool layer.
- Hermes becomes a configurable reasoning provider behind Donnit's model policy, not a hard dependency in the MVP path until its hosted endpoint, key, structured output quality, and tool-calling behavior are validated.
- OpenAI remains the active production provider for structured extraction and reply drafting until Hermes passes the same evals.
- Donnit's own database remains the source of truth for tasks, position profiles, members, permissions, role memory, and audit logs.

## Workspace Isolation

Composio user/entity ids are generated as:

`donnit_<org_id>_<user_id>`

This prevents one customer's connected accounts, actions, or tool history from sharing state with another customer's workspace, even if the same person belongs to multiple workspaces.

## Step-by-Step Build

1. Foundation now
   - Add `@composio/core`.
   - Add a server-only Composio client wrapper.
   - Add model-policy scaffolding for OpenAI/Hermes.
   - Add tests for workspace-scoped Composio ids and write gating.

2. Read-only tool inventory
   - Add an authenticated admin/settings endpoint that lists available Composio tools for a workspace user.
   - Surface tool availability in Workspace Settings.
   - No external writes.

3. Gmail/Slack read actions
   - Register safe read tools for Gmail and Slack.
   - Let the intelligence layer pull source context through Composio when first-party integrations are absent or insufficient.
   - Keep the existing Gmail/Slack implementation active behind the current controls.

4. Permission-gated write actions
   - Add write tools for sending email replies, Slack replies, and calendar events.
   - Require the existing inline confirmation card before any write action executes.
   - Log every tool call with correlation id, side effect, latency, status, and redacted payload.

5. Workspace intelligence context
   - Add a ContextProvider that assembles workspace, actor, role/position profile, task history, recurring duties, source material, and recent decisions.
   - Every AI feature receives context through this provider.

6. Hermes trial behind a flag
   - Add `DONNIT_REASONING_PROVIDER=hermes`.
   - Use Hermes only for reasoning/drafting paths that do not mutate data.
   - Compare against OpenAI on chat-to-task, email reply drafting, and handover/position-profile reasoning evals.

7. Promote or reject Hermes
   - Promote Hermes only if it beats the current provider on factual grounding, structured output validity, task assignment correctness, and latency/cost.
   - Otherwise keep OpenAI as production and revisit Hermes later.

## Required Environment Variables

- `COMPOSIO_API_KEY`
- `DONNIT_LLM_PROVIDER=openai`
- `DONNIT_REASONING_PROVIDER=openai` or `hermes`
- `DONNIT_AI_MODEL=gpt-5-mini`
- `DONNIT_REASONING_MODEL=gpt-5`
- `HERMES_API_KEY` only if Hermes is enabled
- `HERMES_BASE_URL` only if Hermes is enabled
- `HERMES_MODEL` only if Hermes is enabled

## MVP Rule

No Composio write tool may execute without an explicit Donnit confirmation surface. Read tools may run autonomously when the user has connected the relevant account and the workspace permission allows it.
