# CLAUDE.md — Donnit Project Context

> Read this first, every session. It is the map. Canonical detail lives in `docs/intelligence/`.
> Keep this file tight. If a section bloats past ~30 lines, extract to a dedicated doc and link.

---

## 1. What Donnit Is

Donnit is an AI-powered task management product for organizations. To the user it looks like a clean chat-first to-do app — capture, route, complete, log. **Underneath, it's an institutional knowledge platform.** Every task completion, routing decision, manager override, alias correction, and recorded note compounds into a per-org, per-position **brain** that survives staff turnover and that Donnit AI consults on every decision.

**Product principle:** the task surface is the wedge; the institutional memory layer is the moat. Default users never see a "knowledge base" — they do their jobs, and knowledge accrues as a side effect. Admins/managers see the brain explicitly (Brain tab, exports, audit).

**Org-level, not individual.** Users don't own personal brains; the org owns the position's brain, and people pass through positions over time. DB tenant FK is `org_id` referencing `donnit.organizations(id)`. UI sometimes calls it "workspace"; in code always `org_id`.

---

## 2. Memory Architecture — six layers, one map

The canon is `docs/intelligence/task-resolution-memory-architecture.md`. Read it before adding any memory primitive. Quick map of which table owns which layer:

| Layer | Question | Where it lives today |
|---|---|---|
| **1. Starter** | How should Donnit behave in every workspace? | Code: `server/intelligence/donnit-starter-memory.ts` + `docs/intelligence/donnit-starter-memory.md`. Global product behavior, not customer data. |
| **2. Entity** | Who/what exists in this org? | `donnit.organization_members`, `donnit.profiles`, `donnit.position_profiles`, `donnit.tasks`, teams via `position_profile_assignments`. |
| **3. Relationship** | How are entities connected? | Org chart + assignment links across the entity tables. Explicit `workspace_memory_relations` table is *proposed* but not yet built. |
| **4. Alias / Linguistic** | How do users refer to entities in natural language? | `donnit.workspace_memory_aliases` (with `task_resolution_events` for observability and `workspace_memory_conflicts` for the conflict log). Governed by `docs/intelligence/memory-conflict-policy.md`. |
| **5. Session** | What just happened in this conversation? | *Not yet built.* Pending: `donnit.chat_resolution_sessions` (pending task drafts, recent entities, last question). |
| **6. Procedural** | How is this work usually done? | `donnit.task_templates`, recurring tasks, `donnit.position_profile_task_memories` (+ `_steps`, `_runs`, `_attachments`). |
| **Role brain** | What does Donnit know about *this position*? | `donnit.position_profile_knowledge` — the per-role markdown vault. One row per fact, `kind` enum (11 values), `markdown_body`, source-tagged provenance, `confidence_score`, `importance`, `status`. **This is the moat.** |

The **learning pipeline** that promotes signals into policy:

| Stage | Table | Notes |
|---|---|---|
| Append-only ledger of signals | `donnit.learning_events` | Every chat parse, correction, completion, assistant decision. **Insert-only.** |
| Proposed promotions awaiting review | `donnit.learning_candidates` | `candidate_type in ('alias', 'task_profile_step', 'recurrence_rule', 'due_rule', 'owner_rule', 'position_memory', 'preference')`. |
| Active versioned policy | `donnit.policy_versions` | `active` flag, scoped (`workspace` / `user` / `position_profile` / `task_profile` / `task` / `member`). |
| Assistant runtime | `donnit.assistant_runs` + `donnit.assistant_run_events` | `provider in ('openai', 'hermes')` today; 'anthropic' unlocked via the Phase-1 D6 migration. |

**Never invent a parallel memory primitive.** If you think a new table is needed, first prove it's not already covered by one of the rows above.

---

## 3. The Product Principle (UX rule for every feature)

> The task surface is the wedge; the institutional memory layer is the moat.

Practical implications:

- **Default users** see Donnit as a task app. Their actions populate `position_profile_knowledge` and `learning_events` as a side effect of normal task work — never as a knowledge-entry task.
- **Admins/managers** (`role in ('owner', 'admin')` via `donnit.is_org_admin`) see the brain explicitly: the Brain tab on Position Profile, decision-log entries, agent-proposed `learning_candidates` queue, learning-mode setting, vault export.
- **One-tap moments are the highest-leverage UX pattern.** Task completion can prompt: "Anything important about how you resolved this?" → one sentence → an `assistant`-sourced row in `position_profile_knowledge`. ~5 seconds for the user; compounding value for the org.
- **Never expose raw markdown to default users in the main flow.** Render it. Power users get a "view raw" toggle. Admins can edit raw inside the Brain tab.
- **Surface the moat at the boundary.** "Export as Obsidian vault" is the marketable moment. It makes the moat ownable and tangible — and is an admin-tier feature, kept out of the daily flow.

If a feature would force a user to learn a new mental model, it's wrong for v1. Memory accrues without the user thinking about it.

---

## 4. Learning Modes (per-org setting)

The promotion gate that decides how aggressively `learning_candidates` auto-apply.

- **Conservative:** every proposed promotion requires explicit admin approval (default `learning_candidates.status = 'pending_review'`). The system records and surfaces — it never auto-writes.
- **Balanced** (default for MVP): low-risk, high-confidence patterns auto-promote with an audit row in `policy_versions`. High-impact changes (decision rules, removing routing rules, changing handoff notes) still require human approval.
- **Automatic:** high-confidence workflow changes auto-promote. Reserved for mature orgs.

Phase-1 D4 adds `donnit.organizations.learning_mode` + check constraint and wires the existing candidate-promotion code to respect it. Mode switches log a `learning_events` row.

---

## 5. Tech Stack (donnit-1, as of 2026-05)

- **Frontend:** Vite + React + Tailwind under `client/`. Built into `dist/`, served by the same Node process in prod.
- **Server:** Express on Node under `server/`. Entry `server/index.ts`. Tests `server/**/*.test.ts` (Vitest).
- **Shared:** `shared/` (Vitest alias `@shared`).
- **DB / auth:** Supabase Postgres, schema `donnit`. RLS gated by `donnit.is_org_admin(p_org_id)` (admin-only) and `donnit.is_org_member(p_org_id)` (member-readable). Active `org_id` comes from `organization_members` join on `auth.uid()`, not a JWT claim.
- **AI / assistant:** **OpenAI is the default and only-shipped provider.** `assistant_runs.provider` is `('openai', 'hermes')` and will include `'anthropic'` once the Phase-1 D6 migration lands. Switching the *default* provider is a separate product decision and not part of Phase 1.
- **Hosting:** Vercel (frontend + serverless via `vercel.json`).
- **Package manager:** npm. Commands are `npm run <script>` and `npx tsx <file>`. Not pnpm.
- **ORM:** Drizzle (`drizzle.config.ts`, `npm run db:push`) alongside raw Supabase SQL migrations in `supabase/migrations/`.

---

## 6. Key Conventions

- **Tenant isolation:** every query is rooted at `org_id`. RLS on, not optional. New tables mirror `donnit.position_profile_knowledge` / `donnit.position_profiles` RLS patterns — use `donnit.is_org_admin(<table>.org_id)` or `donnit.is_org_member(<table>.org_id)`, never invent a third pattern. Every new endpoint needs a cross-tenant access test.
- **`learning_events` is append-only.** Don't update; insert corrections as new events.
- **Markdown body is canonical, structured columns are the cache.** When `position_profile_knowledge.evidence` and `markdown_body` diverge, body wins — cache the columns from the body, never the other way.
- **`kind` enum on `position_profile_knowledge` is part of the contract.** Adding/removing values requires a migration. The 11 values today: `how_to`, `recurring_responsibility`, `stakeholder`, `tool`, `risk`, `critical_date`, `decision_rule`, `relationship`, `process`, `preference`, `handoff_note`.
- **Reasoning is observable.** `task_resolution_events` captures candidate set, resolution output, decision, model, latency, cost. Every assistant-touched task should expose a "show reasoning" surface that reads from there.
- **Optimistic concurrency on knowledge edits.** When a UI saves a row, the request must include `base_version` (use `memory_key` + a `version` counter if you add one) and the server returns 409 if it's stale. Today the table has no `version` column — propose adding one before any concurrent-edit UI ships.

---

## 7. Things Never To Do

- Never create a parallel memory primitive (a new `*_memory_*` or `memory_*` table) before checking section 2 above to confirm an existing table doesn't already cover it.
- Never expose raw markdown content to a default user in the main flow. Render it.
- Never write a query against any `donnit.*` table without an `org_id` filter. RLS will save you, but defense in depth.
- Never trust a structured column for authority — the markdown body is canonical.
- Never let `learning_candidates` auto-apply without the gate that respects the org's `learning_mode`.
- Never use `workspace_id` in new SQL or TypeScript. DB column is `org_id`. UI strings may say "workspace."
- Never modify `learning_events` rows; insert new ones for corrections.
- Never switch the assistant `provider` default without a deliberate product decision and a benchmark on the eval set.

---

## 8. Repository Layout (current)

```
donnit-1/
├── CLAUDE.md                                ← this file
├── client/                                  ← Vite + React app
├── server/
│   ├── index.ts                             ← Express entry
│   ├── intelligence/
│   │   ├── donnit-starter-memory.ts         ← Layer 1: starter memory canon
│   │   ├── openai-agent.ts                  ← assistant runtime (provider: openai)
│   │   ├── tool-registry.ts / tools/        ← tool-use definitions
│   │   ├── skills/                          ← assistant skills
│   │   ├── observability.ts / model-policy.ts
│   │   └── spellcheck.ts / composio-client.ts
│   ├── routes.ts / app.ts / donnit-store.ts
│   └── *.test.ts                            ← colocated Vitest tests
├── shared/                                  ← shared types/utils (alias @shared)
├── docs/
│   ├── intelligence/
│   │   ├── task-resolution-memory-architecture.md   ← memory architecture canon
│   │   ├── donnit-starter-memory.md
│   │   └── memory-conflict-policy.md
│   ├── AGENTIC_AI_ASSISTANT_ROADMAP.md
│   ├── PRODUCT_FEATURE_BACKLOG.md           ← what's open / in progress
│   ├── PRODUCT_LEAD_MVP_EXECUTION_PLAN.md
│   ├── CTO_MVP_ROADMAP.md / CODEX_WORKPLAN.md
│   └── SUPABASE.md
├── supabase/migrations/
│   ├── 20260514133523_position_profile_durable_memory.sql   ← role brain (canonical)
│   ├── 20260514161500_workspace_memory_aliases.sql           ← layer 4
│   ├── 20260514174956_position_profile_task_memory.sql       ← layer 6
│   ├── 20260514201000_workspace_memory_conflict_policy.sql   ← conflict log
│   ├── 20260515195226_learning_ledger_policy_gate.sql        ← learning pipeline
│   └── 20260513170743_assistant_runs_foundation.sql          ← assistant runtime
└── scripts/                                                  ← one-shot scripts
```

---

## 9. Current Sprint — Phase 1 (Memory Moat Surfaces)

The infrastructure is built. Phase 1 makes it **visible**, **exportable**, and **explainable**. Six deliverables, all additive, no risk to existing flows:

1. **CLAUDE.md** (this file) — unified mental-model map.
2. **Brain tab on Position Profile** — admin-only React view that renders `position_profile_knowledge` rows grouped by `kind`, with rendered markdown, source chips, confidence/importance pills. Read-only first.
3. **Obsidian-compatible vault export** — `GET /api/positions/:id/brain/export` → zip of `.md` files with frontmatter. One file per knowledge row. The moat made tangible.
4. **Learning Modes setting** — `donnit.organizations.learning_mode` column + admin-settings dropdown. Wires the existing `learning_candidates` promotion gate to respect it.
5. **"Why did Donnit route this?" accordion** — task-detail panel that surfaces the `task_resolution_events` row for assistant-touched tasks.
6. **Anthropic provider unlock** — migration adding `'anthropic'` to `assistant_runs.provider` check + env-driven provider routing. Default stays OpenAI.

The brief for Phase 1 lives in the Obsidian vault under `Documents/hermes-vault/Donnit/04-codex-briefs/week-01-foundation.md`.

---

## 10. Working With Claude Code on This Project

- One deliverable per session. Each session opens by reading this file plus the relevant brief.
- Acceptance criteria, manual verification, and "what NOT to build" sections live in the brief.
- After each session: review the diff, run the manual verification, commit, push. Vercel deploys.
- When something feels off architecturally, stop and re-read this file before writing more code. The wrong thing built fast is harder to fix than the right thing built slow.
- **Never invent a memory table.** If you find yourself reaching for a new `*_memory_*` schema, stop and re-read section 2.
