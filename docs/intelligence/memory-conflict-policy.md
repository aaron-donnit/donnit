# Donnit Memory Conflict Policy

Last updated: 2026-05-15

This policy governs how Donnit resolves conflicting memory facts while preserving tenant isolation and role continuity.

## Core Rule

Donnit must never invent a cross-workspace truth from tenant-specific memory. Global starter memory can guide interpretation, but workspace, user, and Position Profile memory remain isolated to their owning workspace.

## Resolution Order

1. **Tenant isolation**: only memory from the current workspace can be read or written.
2. **Scope specificity**: user-scoped memory can override workspace memory for that user; workspace memory can override global defaults; Position Profile memory governs role procedures.
3. **Recency**: within the applicable scope, the latest confirmed fact wins unless the older fact is marked policy-level, permanent, safety-critical, or compliance-critical.
4. **Source authority**: when recency does not settle the conflict, admin/manual/user-confirmed facts beat model inference and low-confidence learned aliases.
5. **Confidence**: confidence breaks ties only after tenant isolation, scope, recency, and source authority.
6. **Clarification**: unresolved or unsafe conflicts require one targeted question.

Hard workspace policies, safety rules, compliance rules, approval rules, OOO/holiday/calendar constraints, and admin settings are guardrails. They can block or constrain an action even when a newer convenience preference exists.

## Conflict Examples

| Conflict | Example | Rule |
| --- | --- | --- |
| Global vs workspace | Global EOD means 5 PM, workspace EOD means 6 PM | Workspace wins |
| Workspace vs user | Workspace requires approval, user prefers auto-send | Workspace policy wins |
| Preference-only workspace vs user | Workspace default meeting is 30 min, user prefers 15 min | User preference can win for that user |
| Old vs new | User previously said Friday, now confirms Thursday | New confirmed fact wins |
| Guess vs explicit | Model infers Priya is finance, user says Priya is ops | Explicit wins |
| Same-scope ambiguity | Two active Alex records match | Ask for clarification |

## Storage Requirements

Every durable memory fact should carry:

- `org_id` or equivalent tenant boundary;
- `scope_type` and `scope_id`;
- source or authority marker;
- timestamp fields;
- confidence score;
- optional expiry for temporary facts;
- status such as active, contested, archived, or rejected.

## Current Implementation

The chat resolver applies these rules to workspace memory aliases by:

- filtering user-scoped aliases to the current user only;
- ignoring expired aliases when the optional expiry field exists;
- scoring scope before recency, source authority, and confidence;
- treating contested aliases as weaker signals;
- preserving tenant isolation through `org_id`-scoped Supabase queries.

The current table foundation is `donnit.workspace_memory_aliases`. Conflict observability is captured through `donnit.task_resolution_events`; a dedicated conflict-log table can be added when the review UI needs to show unresolved memory conflicts to admins.
