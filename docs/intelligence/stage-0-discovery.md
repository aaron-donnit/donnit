# Donnit Intelligence Layer: Stage 0 Discovery Report

Date: 2026-05-11

Status: Stage 0 complete. No runtime code was changed. Stage 1 must not begin until the tool surface and human handoff items in this report are approved.

## Executive Summary

Donnit's current intelligence layer is not an agent architecture yet. The product has two direct OpenAI Responses API call sites inside `server/routes.ts`: one extracts structured tasks from chat, email, Slack, SMS, and documents; the other drafts replies for imported suggestions. Both use schema-constrained JSON output, which is a solid starting point, but neither uses role-scoped context, a tool registry, function calling, retrieval, observability, cost tracking, or permission-gated write tools.

The strongest Stage 1 migration candidate is the suggestion reply drafter because it is small, user-facing, already schema-shaped, and already has an explicit user confirmation step before a reply is sent. The AI Handover Drafter should wait until Stage 3, as specified.

## Inventory 1: Current LLM Integration

| Feature | File and function | Trigger | Model and parameters | Prompt behavior | Output parsing | Current gaps |
| --- | --- | --- | --- | --- | --- | --- |
| AI task extraction | `server/routes.ts`, `extractTaskWithAi` | Chat to task, Gmail scan/manual email import, Slack suggestion endpoint, SMS inbound, document import | OpenAI Responses API. Model is `process.env.DONNIT_AI_MODEL ?? "gpt-4o-mini"`. Timeout is 8 seconds. Uses strict JSON schema. | Large inline system prompt extracts one actionable task, normalizes title/description, identifies urgency, due date, estimate, assignee hint, visibility, recurrence, reply need, and confidence. | `extractOutputText`, `JSON.parse`, then Zod validation with `aiTaskExtractionSchema`. | No tool calls, no role context provider, no retrieval, no logs, no token/cost tracking, no correlation ID, silent fallback on failure. |
| AI reply drafting | `server/routes.ts`, `draftSuggestionReplyWithAi` | Approval inbox reply workflow through `/api/suggestions/:id/draft-reply` | OpenAI Responses API. Model is `process.env.DONNIT_AI_MODEL ?? "gpt-4o-mini"`. Timeout is 9 seconds. Uses strict JSON schema. | Inline system prompt drafts a concise professional response from the Donnit user's perspective without copying the source message. Uses deterministic scenario labels like scheduling, approval, finance, support, request, and general. | `extractOutputText`, `JSON.parse`, Zod validation with `aiReplyDraftSchema`, then weak-draft rejection. | Same architecture gaps as task extraction. Also no role-level memory or signature/tone memory beyond immediate suggestion content and profile signature. |
| Deterministic chat clarification | `server/routes.ts`, pending chat task helpers | Chat to task when required fields are missing | No LLM for continuation state. | Uses parser and pending task state to ask for missing title, due date, urgency, or position profile. | In-memory pending map plus chat system messages and workspace state. | Weak conversational memory, brittle merging, no shared context block, no agent loop, no structured ask-user tool. |
| Health/config reporting | `server/routes.ts`, health routes | Health checks | Exposes whether AI env vars are configured. | Not an LLM call. | Plain JSON health output. | Does not verify model availability, cost logging, or prompt/schema health. |

### Prompts Found

1. Task extraction system prompt in `extractTaskWithAi`.
   - Scope: create at most one task from a source message.
   - Inputs: source, text, sender, subject, channel, fallback title, available assignees, current date, current year, abbreviation map.
   - Output: `donnit_task_extraction` JSON schema.

2. Reply drafting system prompt in `draftSuggestionReplyWithAi`.
   - Scope: generate a concise professional response.
   - Inputs: suggestion source, sender, subject, source body, generated task, reply scenario, user instruction.
   - Output: `donnit_reply_draft` JSON schema.

No prompt composer, skill registry, reusable constitution prompt, tool catalog, or Handover Drafter prompt exists today.

## Inventory 2: Existing Product Capabilities And Draft Tool Surface

The product already has useful operations that can become typed agent tools. Most are currently Express routes backed by `DonnitStore`.

### Existing Capabilities

| Capability area | Existing routes or store methods | Side effect class | Tool potential |
| --- | --- | --- | --- |
| Workspace/profile bootstrap | `/api/auth/me`, `/api/auth/bootstrap`, `/api/bootstrap`, `getProfile`, `bootstrapWorkspace` | Read/write | Context provider actor and workspace setup. Not a first agent tool. |
| Members and teammates | `/api/admin/members`, `/api/admin/members/create`, `listOrgMembers` | Read/write | Read teammate profiles, relationship maps, permissions. |
| Tasks | `/api/tasks`, `/api/tasks/:id`, `/api/tasks/:id/complete`, `/api/tasks/:id/postpone-day`, `/api/tasks/:id/postpone-week`, `listTasks`, `createTask`, `updateTask`, `getTask` | Read/write | Open tasks, inherited tasks, current work, task history, write-confirmed task mutation. |
| Task subtasks | `/api/tasks/:id/subtasks`, `listTaskSubtasks`, `createTaskSubtask`, `updateTaskSubtask`, `deleteTaskSubtask` | Read/write | Handover readiness and task decomposition. |
| Task templates | `/api/task-templates`, `listTaskTemplates`, `createTaskTemplate`, `updateTaskTemplate`, `deleteTaskTemplate` | Read/write | Recurring work patterns and role playbooks. |
| Task events/activity | `addEvent`, `listEvents` | Read/write | Role activity timeline and evidence retrieval. |
| Chat messages | `/api/chat`, `listChatMessages`, `createChatMessage` | Read/write | Conversation state, ask-user continuation, but must be separated from agent state. |
| Email suggestions | `/api/suggestions/:id`, `/approve`, `/dismiss`, `/draft-reply`, `/reply`, `listEmailSuggestions`, `createEmailSuggestion`, `updateEmailSuggestion`, `getEmailSuggestion` | Read/write | Approval inbox, reply drafting, source artifact retrieval. |
| Gmail integration | `/api/integrations/google/gmail/*` | Read/write external | External read/write tools, permission-gated and OAuth scoped. |
| Google Calendar export | `/api/integrations/google/calendar/export` | Write external | Calendar write tool, permission-gated. |
| Slack integration | `/api/integrations/slack/suggest`, `/events` | Read/write inbound | Future Slack read/suggest source. Write back to Slack is not implemented. |
| SMS integration | `/api/integrations/sms/inbound` | Read/write inbound | MVP coming-soon path; inbound task creation exists. |
| Documents | `/api/documents/suggest` | Read/upload and suggestion write | Source artifact parsing and approval suggestion creation. |
| Position profiles | `/api/position-profiles`, `/assign`, `/tasks`, `listPositionProfiles`, `createPositionProfile`, `updatePositionProfile`, `deletePositionProfile`, `createPositionProfileAssignment` | Read/write | Core role identity, role assignment, transition memory, continuity views. |

### Minimum Stage 1 Tool Surface For Handover Path

This is the draft table to approve before Stage 1. Implementing all of these is not required in Stage 1, but the registry shape should support them.

| Tool name | Input | Output | Side effect | Idempotency | Current backing data |
| --- | --- | --- | --- | --- | --- |
| `get_role` | `{ role_id }` | Role definition, owners, managers, status, memory summary | Read | Safe to retry | `position_profiles`, `position_profile_assignments` |
| `list_open_tasks` | `{ role_id, since? }` | Open/incomplete tasks owned by or inherited through the role | Read | Safe to retry | `tasks.position_profile_id`, task status fields |
| `list_recent_activity` | `{ role_id, window_days }` | Recent task events, comments, status changes, assignment changes | Read | Safe to retry | `task_events`, task timestamps |
| `search_role_memory` | `{ role_id, query, top_k }` | Ranked snippets with source and confidence | Read | Safe to retry | Future RoleMemory table; partial source exists in `position_profile_knowledge` |
| `get_teammate` | `{ teammate_id }` | Teammate profile, role, permissions-safe contact data | Read | Safe to retry | `profiles`, `organization_members` |
| `list_relationships` | `{ role_id }` | Relationship map by internal/external stakeholder | Read | Safe to retry | Position profile memory/access inventory; no first-class relationship table yet |
| `draft_handover_packet` | `{ role_id, sections, outgoing_user, incoming_user?, idempotency_key }` | Draft handover packet artifact ID and sections | Write | Requires idempotency key | No artifact table yet |
| `ask_user` | `{ question, options? }` | Clarification answer or paused state | Read/pause | Safe to retry | Front-end chat/agent UI needed |

### Recommended Stage 1 Proof Feature

Migrate `draftSuggestionReplyWithAi` first. It is the smallest existing user-facing intelligence feature, already structured, and the final external send already requires explicit user action. The migration would prove the registry, model wrapper, schema validation, observability, and permission boundary without taking on the full Handover Drafter yet.

## Inventory 3: Data Model And Role Context Storage

### Current Entities

| Entity | Location | Notes |
| --- | --- | --- |
| Organizations | Supabase `donnit.organizations` | Workspace boundary. |
| Profiles | Supabase `donnit.profiles` | User identity, display name, email signature columns. |
| Organization members | Supabase `donnit.organization_members` | Role/permission membership and manager relationships. |
| Tasks | Supabase `donnit.tasks` | Includes owner/assignee, status, urgency, due date, estimate, recurrence, privacy, delegated/collaborator fields, source fields, and position profile association. |
| Task events | Supabase `donnit.task_events` | Activity log source for recent role activity. |
| Chat messages | Supabase `donnit.chat_messages` | Chat surface history and pending task continuity. |
| Email suggestions | Supabase `donnit.email_suggestions` | Approval inbox items and source message context. |
| Gmail accounts | Supabase `donnit.gmail_accounts` | OAuth tokens/status for Gmail integration. |
| Workspace state | Supabase `donnit.user_workspace_state` | Onboarding, pending chat state, UI setup state. |
| Position profiles | Supabase `donnit.position_profiles` | Current role/profile identity and institutional memory JSON. |
| Position profile assignments | Supabase `donnit.position_profile_assignments` | Historical/current assignment events. |
| Position profile knowledge | Supabase `donnit.position_profile_knowledge` | Existing non-vector role knowledge table. Could seed future RoleMemory. |
| Task subtasks | Supabase `donnit.task_subtasks` | Subtask primitive. |
| Task templates and subtasks | Supabase `donnit.task_templates`, `donnit.task_template_subtasks` | Reusable task playbooks. |

### Role Context Today

Role-level context is partially available through:

- `position_profiles.title`, `status`, `current_owner_id`, `direct_manager_id`, `temporary_owner_id`, `delegate_user_id`, and `delegate_until`.
- `position_profiles.institutional_memory`, currently a JSON-style bucket for role memory, access inventory, responsibilities, cadence, and notes.
- `tasks.position_profile_id`, which ties active and historical tasks to a role.
- `position_profile_assignments`, which records profile assignment transitions.
- `position_profile_knowledge`, which can become the seed for a proper RoleMemory table.
- `task_events`, which can become recent activity evidence.

### Data Model Gaps For The Target Architecture

- No `RoleMemory` table with embeddings, fact type, source event, expiry, and retrieval metadata.
- No pgvector extension or managed vector store integration.
- No embedding model, embedding dimension, or re-embedding policy.
- No first-class handover packet artifact table.
- No agent session table for correlation IDs, step logs, cost, token counts, and latency.
- No tool call log table.
- No idempotency key model for agent write tools.
- No feature flag or per-workspace AI skill allowlist table.
- No first-class relationship map table; relationships are currently inferred or stored in flexible memory fields.

## Inventory 4: Test Infrastructure

| Area | Current state |
| --- | --- |
| Test runner | No configured test runner found in `package.json`. |
| Scripts | `npm run check` runs TypeScript. `npm run build` runs the production build. No `npm test`. |
| Test files | No active test files found. `tsconfig.json` excludes `**/*.test.ts`, but the repo does not currently appear to have test coverage. |
| CI | No `.github` workflow directory found. Vercel builds run `npm run build`. |
| Mocking | No established LLM mocking pattern found. |
| Current smoke checks | TypeScript check, production build, and manual endpoint/browser testing. |

### Stage 1 Implication

The Stage 1 acceptance criteria require at least three tests for the migrated feature. Before or during Stage 1, Donnit needs a minimal test harness. Recommended path: add Vitest for server-side unit tests of the tool registry, model wrapper, permission-denied behavior, and missing-context handling. Browser or E2E tests can wait until the streaming UI work begins.

## Inventory 5: Front-End Intelligence Surfaces

| Surface | Location | Current behavior | Agent-readiness gap |
| --- | --- | --- | --- |
| Chat to task | `client/src/App.tsx` main workspace chat panel | User types task-like input; server creates task or asks clarifying questions. | No streaming agent status, no role-scoped context display, weak conversation state, no tool-step rendering. |
| Approval inbox | `client/src/App.tsx` approval queue | Shows imported suggestions from email, Slack, SMS, and documents for approval/dismissal/editing. | Good candidate for agent suggestions, but no tool trace, no confidence explanation, no permission prompt pattern beyond approve/dismiss. |
| Reply draft modal | `client/src/App.tsx` suggestion reply dialog | User generates/regenerates reply, edits it, then sends. | Best Stage 1 proof surface. Needs agent call status, correlation ID, and clearer confidence/source explanation. |
| Document import | `client/src/App.tsx` document upload dialog | Upload PDF/Word/text; creates task suggestions. | Needs source artifact references and role-aware interpretation. |
| Agenda | `client/src/App.tsx` agenda panel | Deterministic scheduling and export flow. | Could become a future Skill, but not a Stage 1 target. |
| Position profiles | `client/src/App.tsx` position profile panel | Admin list/detail, transfer/delegate/access inventory/task history. | No AI Handover Drafter yet. Needs packet draft UI, streaming steps, ask-user pauses, and confirm-before-write modal. |
| Manager/team view | `client/src/App.tsx` manager reporting/team surfaces | Read-only team task status and progress visibility. | Can supply context but should not become a write surface without confirmation. |

## Risks

1. AI logic is concentrated in a monolithic `server/routes.ts`, which will make agent architecture hard to review unless Stage 1 extracts clean modules.
2. AI failures often fall back silently, which protects uptime but hides quality and cost issues.
3. There is no observability for LLM calls, tool calls, token use, cost, latency, or correlation IDs.
4. There is no role-scoped context provider. The current LLM sees immediate source text and some assignee labels, not role memory.
5. There is no vector search or embedding pipeline.
6. There is no test harness, so Stage 1 must create one before it can satisfy acceptance criteria.
7. There is no Handover Packet artifact table or draft lifecycle yet.
8. Write permissions are enforced at route/RLS level, but there is no LLM-specific permission prompt or idempotency pattern.
9. Current chat state is not robust enough for complex multi-turn workflows.
10. The product's core workforce-continuity value depends on trustworthy role memory; today that memory is flexible JSON plus task history, not a retrieval-grade knowledge system.

## Stage 1 Recommendation

Stage 1 should be a small infrastructure wedge, not a big feature expansion:

1. Create `server/intelligence/` with tool registry, model client wrapper, schemas, observability logger, and a first Skill wrapper.
2. Add a database-backed or structured server log sink for AI sessions and tool calls.
3. Add Vitest or an equivalent minimal test harness.
4. Migrate the reply draft feature to the new wrapper as the proof.
5. Delete the old reply-draft direct prompt path after the migration passes.
6. Leave AI task extraction and Handover Drafter untouched until the Stage 1 proof is accepted.

## Human Handoff Items Before Stage 1

=== HUMAN HANDOFF REQUIRED ===
Stage: 0 Discovery
Blocking step: Stage 1 cannot start until the initial tool surface, model policy, observability sink, and permission UX decisions are approved.
Why I can't do this alone: These choices affect cost, privacy, user trust, and production behavior. I can recommend defaults, but the product owner must sign off before the agent layer begins making tool-mediated decisions.

What I need you (the human) to do, step by step:
1. Approve or edit the draft tool surface table in this report, especially the minimum Handover Drafter tools.
2. Confirm model policy for Stage 1: continue using OpenAI, and specify the small/fast model and reasoning model names you want Donnit to standardize on.
3. Confirm whether US-hosted OpenAI processing is acceptable for MVP, or whether data residency constraints apply.
4. Choose the observability sink for Stage 1: Supabase tables inside the Donnit database, Vercel logs only, or a third-party observability tool.
5. Approve the Stage 1 proof feature recommendation: migrate the suggestion reply drafter first.
6. Decide how permission-gated write tools should be shown in the UI for v1: modal confirmation, inline confirmation card, or approval inbox item.
7. Confirm whether Stage 1 should add Vitest as the first formal test harness.

What I'll do after you confirm:
- Build the Stage 1 tool registry, model wrapper, observability logging, minimal tests, and the first migrated intelligence feature behind a feature flag.

If you want to proceed differently, say "proceed with <alternative>".
If you want me to pause entirely, say "pause".
=== END HANDOFF ===

