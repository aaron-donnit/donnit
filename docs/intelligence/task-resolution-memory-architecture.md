# Donnit Task Resolution Memory Architecture

Last updated: 2026-05-14

This document incorporates the external architecture review shared on 2026-05-14 and turns it into Donnit's product and engineering direction for memory-driven task creation.

## Executive Assessment

The review is directionally correct and matches the failures seen in Donnit's chat parser:

- Starter memory is necessary, but it is not sufficient.
- A bigger prompt will not reliably resolve "the assistant", "EOW", "call Maya at 230", or "the board packet".
- Donnit needs a layered memory system, bounded retrieval, confidence scoring, and code-level decision thresholds.
- The LLM should parse and reason over a short candidate set. It should not invent entities from the whole organization.
- When Donnit lacks confidence, it should ask one targeted clarification instead of creating a bad task.

The important product conclusion: Donnit memory must act like an operating system for work, not a notes field. It needs to know the workspace's people, roles, aliases, routines, recurring artifacts, and recent conversation state before the LLM tries to turn messy language into action.

## Donnit Memory Layers

### 1. Starter Memory

Question answered: How should Donnit behave in every workspace?

Source today:

- `server/intelligence/donnit-starter-memory.ts`
- `docs/intelligence/donnit-starter-memory.md`

Purpose:

- Product behavior, tone, task interpretation rules, privacy rules, agenda behavior, and default ask-don't-guess rules.
- This is global Donnit intelligence. It is not customer data.

Limits:

- It does not know a customer's actual people, departments, aliases, events, or recurring work.
- It cannot by itself know that "the assistant" means Jordan in one workspace and Nina in another.

### 2. Entity Memory

Question answered: Who and what exists in this workspace?

Current and target sources:

- Members/profiles.
- Position Profiles.
- Teams and org chart.
- Tools and access inventory.
- Future: projects, artifacts, recurring deliverables, vendors, important meetings.

Examples:

- Nina Patel, Executive Assistant.
- Jordan Lee, Recruiting Coordinator.
- Executive Assistant to the CEO Position Profile.
- Board packet, quarterly artifact.
- Payroll report, recurring finance deliverable.

### 3. Relationship Memory

Question answered: How are entities connected?

Current and target sources:

- Manager and direct-report relationships.
- Position Profile owner, delegate, and temporary coverage state.
- Task assignment, delegation, collaboration, and reassignments.
- Future: explicit relation table for reports_to, owns, responsible_for, collaborates_with, covers_for.

Examples:

- Jordan reports to Aaron.
- Executive Assistant to the CEO is assigned to Jordan.
- Board packet is normally owned by the Executive Assistant profile.
- Payroll reports are owned by Finance Coordinator.

### 4. Alias And Linguistic Memory

Question answered: How do users refer to workspace entities in natural language?

Target sources:

- Workspace alias table.
- Learned corrections from chat and task edits.
- Position Profile title aliases.
- Department and team shorthand.
- Artifact/template trigger phrases.

Examples:

- "the assistant" -> Jordan Lee, scoped to Aaron or to Executive Office.
- "EA" -> Executive Assistant to the CEO.
- "People Ops" -> HR.
- "board packet" -> recurring board meeting packet artifact/template.
- "monthly close" -> Finance Coordinator recurring workflow.

Rules:

- Alias lookup should check user/workspace scope first, then global workspace aliases.
- Ambiguous aliases should ask.
- Aliases should decay or be disabled when a person leaves or a profile is reassigned.

### 5. Session Memory

Question answered: What has just happened in this conversation?

Target sources:

- Pending chat task draft.
- Recent entities mentioned in chat.
- Recent created tasks.
- Pending clarification question and allowed answer shape.
- Current UI view and selected task/profile when available.

Examples:

- User says "assign Nina to prep the RIF list".
- Donnit asks "When is this due?"
- User replies "EOD Friday, confidential".
- Donnit merges the answer into the pending task instead of reparsing the reply as a new task.

Rules:

- Follow-up replies should update the pending spec.
- Donnit should not re-decide already resolved fields unless the user explicitly corrects them.
- Pronouns like "it", "that", "her", and "him" should only resolve from recent session candidates.

### 6. Procedural Memory

Question answered: How is this work usually done?

Current and target sources:

- Task templates.
- Recurring tasks.
- Position Profile historical task patterns.
- Completion notes and task logs.
- Future learned workflows and assistant skills.

Examples:

- Board packet usually has subtasks for financials, CEO update, committee reports, review, and distribution.
- Quarterly reports appear five days before the end of the quarter unless configured otherwise.
- Vendor renewal tasks usually route to Operations and need contract review.

Rules:

- Procedural memory can suggest default due dates, urgency, subtasks, profile routing, and related artifacts.
- Defaults must be marked as inferred.
- Repeated accepted defaults should become stronger over time.
- Corrections should lower confidence and create/update memory.

## Task Resolution Pipeline

### Step 1: Lightweight Parse

The first model or deterministic extractor should identify raw phrases without resolving them.

Input:

```text
assign the assistant with preparing the board packet by eod friday
```

Output:

```json
{
  "intent": "create_task",
  "action": "assign",
  "assignee_phrase": "the assistant",
  "object_phrase": "preparing the board packet",
  "temporal_phrase": "by eod friday",
  "priority_phrase": null,
  "privacy_phrase": null,
  "recurrence_phrase": null
}
```

Rules:

- Do not resolve people or profiles in this step.
- Do not clean the task title yet.
- Return structured output only.

### Step 2: Candidate Retrieval

Code retrieves a bounded candidate set from memory before the reasoning model runs.

Candidate sources:

- Exact aliases scoped to the user and workspace.
- Fuzzy profile title and role tag matches.
- Active team members and direct reports.
- Position Profiles available to the assignee.
- Recent session entities.
- Task templates and recurring work matching the object phrase.
- Position Profile knowledge snippets.

Retrieval should cap each candidate group to roughly five entries. If retrieval returns too many plausible options, that is itself a signal to ask a clarifying question.

Retrieval should run in stages:

1. Hard filters: active entity, correct slot type, same organization, and reachable scope.
2. Exact lookups: scoped alias, canonical name, email, and Position Profile title.
3. Structured fuzzy: prefix matches, role tags, title acronyms, and role shorthand such as EA or recruiting.
4. Semantic fallback: vector similarity over aliases, artifacts, and profile memory only after exact/structured retrieval returns too little signal.
5. Score and rank: use a small candidate set with margin-aware confidence.

Vector search is useful later, but it should be a fallback, not the first path. Most Donnit task routing should be solved through exact alias, role, org chart, session recency, and procedure/template signals.

### Step 2.5: Margin-Aware Ranking

Donnit should score candidates and convert the score to confidence using both the top score and the distance between the top candidate and the runner-up.

Why:

- "Aaron Blake" should beat "Aaron Hassett" because the full-name match creates a large score margin.
- "Aaron" should ask when there are two Aarons because the top two candidates are tied or close.
- "Recruiting Coordinator" should resolve when it is exact, but "recruiting" should ask if there are multiple recruiting profiles.

Starting score factors:

- Surface match: exact alias, prefix, canonical name, email, title, acronym.
- Scope: user-scoped aliases beat team aliases; team aliases beat global workspace aliases.
- Session recency: recently mentioned people/artifacts matter more for pronouns and vague references.
- Long-term recency: recently used aliases should rank higher than stale aliases.
- Usage frequency: repeated accepted aliases should strengthen slowly.
- Slot fit: people who are frequently assignees are stronger assignee candidates; artifacts/templates are stronger object candidates.

Confidence should be lowered when the top candidate and runner-up are close, even if the top score is high. That margin rule is the main guardrail against repeated wrong assignments in workspaces with duplicate names or similar roles.

### Step 3: Resolution And Inference

The LLM receives:

- Original message.
- Parsed raw phrases.
- Candidate people/profiles/artifacts/templates.
- Relevant starter memory.
- Workspace aliases.
- Recent session state.
- Current date/time and user timezone.

It returns a structured task resolution with confidence scores:

```json
{
  "resolved": {
    "intent": "create_task",
    "assignee": {
      "entity_id": "member_123",
      "display_name": "Jordan Lee",
      "confidence": 0.96,
      "inferred": false,
      "reason": "Matched scoped alias 'the assistant'."
    },
    "title": {
      "value": "Prepare the board packet",
      "confidence": 0.91,
      "inferred": false,
      "reason": "Cleaned from object phrase."
    },
    "due": {
      "value": "2026-05-15T17:00:00-04:00",
      "confidence": 0.88,
      "inferred": false,
      "reason": "EOD Friday from current date."
    },
    "position_profile": {
      "entity_id": "profile_ea_ceo",
      "display_name": "Executive Assistant to the CEO",
      "confidence": 0.9,
      "inferred": true,
      "reason": "Assignee's primary profile owns board packet tasks."
    },
    "recurrence": {
      "value": null,
      "confidence": 1,
      "inferred": false,
      "reason": null
    }
  },
  "gaps": [],
  "ambiguities": [],
  "should_ask": false
}
```

Rules:

- The model may only resolve to provided candidates.
- The model must mark inferred fields.
- The model must expose gaps.
- The model must ask at most one targeted question.
- No actionable field should be regex-parsed from prose.

### Step 4: Code-Level Decision

Thresholds belong in code, not in the prompt.

Recommended v1 thresholds:

- Create directly: all required fields present and critical confidence >= 0.9.
- Create with transparent confirmation: required fields present, one or more non-critical inferred fields >= 0.75.
- Ask before creating: assignee confidence < 0.85, title/object missing, due time ambiguous for time-specific task, duplicate first-name match, or profile routing conflict.
- Refuse or route to review: input is not actionable, unsafe, outside permissions, or asks Donnit to invent facts.

Required baseline fields:

- Task title.
- Owner/assignee.
- Due date or explicit no-due-date state.
- Workspace/org.

### Step 5: Clarification Merge

When Donnit asks a question, it stores the pending task spec in session memory. The next user reply should update that spec instead of starting over.

Example:

```text
User: assign the assistant with preparing the board packet
Donnit: I can do that. Which due date should I use?
User: EOD Friday and make it high priority
Donnit: Created: Prepare the board packet for Jordan Lee, due Friday at 5:00 PM. High priority.
```

Rules:

- Previously resolved fields stay fixed unless explicitly corrected.
- The reply can fill multiple missing fields.
- If the reply introduces a new ambiguity, Donnit asks one follow-up question.

### Step 6: Feedback Loop

Every correction should become training data for workspace memory.

Examples:

- User corrects "assistant" from Aaron to Jordan: create or strengthen alias "assistant" -> Jordan scoped to Aaron/workspace.
- User changes profile routing for "board packet": add artifact/template relationship to Executive Assistant profile.
- User rejects inferred due date: weaken that procedural default.
- User marks a task personal: prevent it from entering Position Profile memory.

The system should log:

- Original utterance.
- Parsed slots.
- Candidate set.
- Resolution result.
- User correction or acceptance.
- Final task created.

Feedback signals should be weighted:

- Explicit correction: strongest signal. Example: "No, I meant Priya."
- Clarification answer: strongest positive signal for the chosen candidate and mild negative signal for unchosen candidates.
- Silent edit: strong signal when the user changes assignee, profile, due date, recurrence, or title after creation.
- Implicit acceptance: weak signal only. The user may not have noticed a mistake.
- Undo/recreate: strong negative signal for the original resolution.
- Task completion: weak-to-medium validation that the assignment probably made sense.

Learned aliases should start below the auto-execute threshold. They should participate in future resolution, but Donnit should confirm until repeated user behavior strengthens them. If the same surface form resolves to multiple entities over time, mark it contested and always ask.

Aliases should decay when unused, especially for role-based terms like "the assistant" or project-based terms that can change after role transfers or employee churn.

## Donnit-Specific Decisions

Accepted from the review:

- Five-layer memory model.
- Bounded candidate retrieval before reasoning.
- Confidence scoring for entity resolution.
- Margin-aware confidence based on top-vs-runner-up score.
- Code-owned thresholds.
- One targeted clarification at a time.
- Pending-task session memory.
- Correction-to-memory feedback loop.
- Contested alias guardrails.
- Alias decay for stale or role-changed terms.

Modified for Donnit:

- Start with Postgres lexical/fuzzy retrieval and existing Supabase tables. Add vector search later when memory volume justifies it.
- Treat Position Profiles as the core role subject. People are holders of profiles; durable knowledge belongs primarily to the role.
- Starter memory remains global product behavior. Customer-specific language belongs in workspace memory. Institutional knowledge belongs in Position Profile memory.
- Handover and workforce continuity are the highest-value procedural memories, not generic project templates.

Rejected for now:

- Importing hidden model memory, OpenAI private tokens, or broad external knowledge into Donnit. Donnit should use model reasoning, but store its own explicit, auditable memory.
- Letting the LLM resolve against the full workspace without candidate retrieval.
- Silent writes when confidence is low.

## Proposed Data Additions

These are implementation targets, not yet required migrations.

### `donnit.workspace_memory_aliases`

Stores workspace-specific language mappings.

Suggested fields:

- `id`
- `org_id`
- `surface_form`
- `normalized_form`
- `target_type`
- `target_id`
- `scope_type`
- `scope_id`
- `confidence`
- `source`
- `usage_count`
- `last_used_at`
- `disabled_at`
- `created_at`
- `updated_at`

### `donnit.workspace_memory_relations`

Stores flexible relationships across people, profiles, tasks, artifacts, tools, and templates.

Suggested fields:

- `id`
- `org_id`
- `relation_type`
- `from_type`
- `from_id`
- `to_type`
- `to_id`
- `metadata`
- `confidence`
- `source`
- `created_at`
- `updated_at`

### `donnit.chat_resolution_sessions`

Stores pending task specs and recent entity context.

Suggested fields:

- `id`
- `org_id`
- `actor_id`
- `status`
- `pending_spec`
- `recent_entities`
- `last_question`
- `created_at`
- `updated_at`
- `expires_at`

### `donnit.task_resolution_events`

Stores observability and learning events.

Suggested fields:

- `id`
- `org_id`
- `actor_id`
- `source`
- `original_text`
- `parsed_slots`
- `candidate_snapshot`
- `resolution_output`
- `decision`
- `created_task_id`
- `correction`
- `latency_ms`
- `model`
- `cost_usd`
- `created_at`

## Implementation Plan

### Phase 1: Memory-Aware Eval Expansion

Add eval cases for:

- Role aliases: assistant, EA, recruiter, finance lead, sales lead.
- Ambiguous first names and duplicate names.
- Contact-vs-assignment: "call Maya" should stay with the speaker.
- Time ambiguity: "230" should ask AM/PM when not inferable.
- Recurrence: "first Monday of every month".
- Artifacts: board packet, payroll report, vendor renewal.
- Clarification merge: second response fills missing due date/urgency.
- Corrections: "No, I meant Jordan" strengthens alias.

### Phase 2: Workspace Alias Memory

Build `workspace_memory_aliases` and resolve people/profile aliases before task creation.

Acceptance:

- "the assistant" resolves only when high-confidence.
- Ambiguous aliases ask.
- Corrections can be stored as workspace aliases.

### Phase 3: Candidate Retrieval Layer

Build a shared `TaskResolutionContextProvider` that returns candidate people, profiles, aliases, templates, recent entities, and procedural defaults.

Acceptance:

- Chat parsing no longer scans loosely across all members without confidence.
- Candidate set is logged with each task resolution event.
- Candidate scoring uses top-vs-runner-up margin so similar names/roles ask instead of guessing.
- New evals pass without special-casing every phrase.

Current implementation note:

- The chat parser now uses a first-pass margin-aware resolver for members and Position Profiles. It is still deterministic and does not yet persist workspace aliases or correction signals.

### Phase 4: Structured Resolution Contract

Replace ad hoc chat extraction with a structured resolution output that separates parse, resolve, infer, gaps, and final decision.

Acceptance:

- No task is created from low-confidence assignee resolution.
- Due-time ambiguity triggers one question.
- Generated task titles are grammatically cleaned before save.

### Phase 5: Session Clarification Merge

Persist pending task specs and merge user replies.

Acceptance:

- Donnit no longer forgets what it asked.
- Follow-up answers create clean confirmations.
- The second turn cannot become a malformed task title.

### Phase 6: Correction-To-Memory Loop

When users edit created tasks or correct Donnit in chat, save the correction as memory when reusable.

Acceptance:

- Accepted corrections improve future routing.
- Personal/confidential rules are respected.
- Admins can view and remove workspace memory later.
- Contested aliases always ask before writing.
- Stale aliases decay or archive after inactivity.

## MVP Impact

For the first customer, the highest-impact subset is:

1. Workspace alias memory for people and Position Profiles.
2. Candidate retrieval for task assignment.
3. Structured resolution with confidence and gaps.
4. Session clarification merge.
5. Eval coverage for the failure prompts already found.

This is the shortest path to Donnit feeling intelligent: not because it knows everything, but because it reliably uses what it knows and asks when it does not.
