# Donnit Intelligence Layer: Stage 1 Report

Date: 2026-05-11

Status: Stage 1 implementation complete and waiting for human review, Supabase migration application, and production validation. Stage 2 has not started.

## What Changed

Stage 1 moved the first user-facing AI feature from a direct prompt call into a thin agent foundation:

- Added a typed `ToolRegistry` with input schema, output schema, side-effect classification, idempotency metadata, and permission-gated execution.
- Added a reusable OpenAI Responses tool loop that can send tool catalogs, execute function calls, validate final structured output, and enforce tool-step caps.
- Added Supabase-backed AI observability tables for sessions, model calls, and tool calls.
- Added obfuscated logging for request payloads, response payloads, latency, model name, token counts, estimated dollar cost, tool inputs, tool outputs, success/failure, and correlation ID.
- Added the initial Handover Drafter tool surface with schemas for:
  - `get_role`
  - `list_open_tasks`
  - `list_recent_activity`
  - `search_role_memory`
  - `get_teammate`
  - `list_relationships`
  - `draft_handover_packet`
  - `ask_user`
- Migrated the suggestion reply drafter proof feature to the new tool-call architecture.
- Deleted the old direct OpenAI reply-drafting prompt path.
- Added Vitest as the first formal test harness.

The AI Handover Drafter itself was not implemented in this stage. That remains Stage 3.

## Architecture

### Modules

| Module | Purpose |
| --- | --- |
| `server/intelligence/tool-registry.ts` | Registers typed tools, converts them into OpenAI-compatible tool definitions, validates inputs/outputs, and blocks write tools unless `allowWrites` is true. |
| `server/intelligence/openai-agent.ts` | Wraps the OpenAI Responses API with tool-calling, structured output validation, token/cost logging, latency logging, and step limits. |
| `server/intelligence/observability.ts` | Creates AI sessions, redacts PII/secrets from logs, writes model/tool call logs, and tracks session cost. |
| `server/intelligence/skills/reply-drafter.ts` | First migrated Skill. The model must call `get_email_suggestion_context` before producing a schema-validated reply draft. |
| `server/intelligence/tools/handover-tools.ts` | Stage 1 Handover Drafter tool surface with safe read tools and permission-gated write behavior. |

### Observability Tables

Migration: `supabase/migrations/20260511204432_intelligence_observability.sql`

Tables:

- `donnit.ai_sessions`
- `donnit.ai_model_calls`
- `donnit.ai_tool_calls`

RLS:

- Workspace members can view logs for their org.
- Authenticated members can create their own session/model/tool logs.
- Session updates are restricted to the creating user.
- No delete grants are added.

## Migrated Proof Feature

Feature: Approval inbox reply drafter.

Old behavior:

- Route called OpenAI directly from `server/routes.ts`.
- The prompt and output schema lived inside the route file.
- There was no tool call, no correlation ID, no persistent cost logging, and no tool-level observability.

New behavior:

- Route calls `draftSuggestionReplyWithAgent`.
- The Skill creates an AI session with a correlation ID.
- The model receives the `get_email_suggestion_context` tool.
- The model must call the tool before drafting.
- The final response is validated against `replyDraftOutputSchema`.
- The route still saves the draft only after server-side validation.
- Sending the actual reply remains user-confirmed through the existing UI.

## Permission-Gated Writes

The registry blocks all write tools unless `allowWrites` is explicitly true. This is tested against the `draft_handover_packet` tool. The current reply drafter uses only a read tool, so it does not mutate workspace state through the agent loop.

The existing route still updates the suggestion with the generated draft after the user requests a draft. That write is outside the LLM tool loop and uses the existing application permission path.

## Cost Discipline

The wrapper logs estimated cost per model call and accumulates cost per AI session. Pricing is currently calculated with an internal model-price table for common OpenAI models and returns `0` for unknown models instead of inventing a cost.

Current model policy:

- Small/fast model: `process.env.DONNIT_AI_MODEL ?? "gpt-5-mini"`
- Reasoning model placeholder: `process.env.DONNIT_REASONING_MODEL ?? "gpt-5"`

The reasoning model is recorded in policy metadata but not used by this Stage 1 proof feature.

## Tests

Added `npm run test` with Vitest.

Coverage added:

1. Happy path: reply drafter calls the typed read tool, returns a structured draft, and logs model/tool activity.
2. Permission denied path: `draft_handover_packet` is blocked without explicit confirmation.
3. Missing context path: missing suggestion context returns a non-invented response.

Verification run:

- `npm run test` passed.
- `npm run check` passed.
- `npm run build` passed.

## Deferred Items

- Stage 2: real `ContextProvider`, RoleMemory table, embeddings, hybrid retrieval, caching, and role-scope isolation tests.
- Stage 3: full AgentLoop, streaming UI, cancel support, `ask_user` pause/resume, Handover Drafter Skill, and handover packet artifact persistence.
- Stage 4: PromptComposer and eval harness.
- The `search_role_memory` Stage 1 implementation is lexical over existing position profile memory. It is intentionally a bridge until Stage 2 vector retrieval.
- The `draft_handover_packet` Stage 1 tool is permission-gated and schema-ready, but does not persist a handover artifact yet because the artifact model belongs in Stage 3.

## Human Handoff

=== HUMAN HANDOFF REQUIRED ===
Stage: 1 Tool surface and function calling
Blocking step: The Supabase observability migration must be applied before production AI observability can persist.
Why I can't do this alone: Applying a migration changes the production database schema. The implementation is committed, but a human-approved production database action is required before the deployed feature can fully satisfy Stage 1 observability.

What I need you (the human) to do, step by step:
1. Open Supabase SQL Editor for the Donnit project.
2. Open `supabase/migrations/20260511204432_intelligence_observability.sql` from the repo.
3. Paste the full SQL into the SQL Editor.
4. Run it once.
5. Confirm it completes without error.
6. Redeploy or let Vercel deploy the latest commit.
7. Test Approval Inbox -> Generate Reply and confirm the response includes a usable draft.

What I'll do after you confirm:
- Review the production behavior and then wait for explicit approval before starting Stage 2.

If you want to proceed differently, say "proceed with <alternative>".
If you want me to pause entirely, say "pause".
=== END HANDOFF ===
