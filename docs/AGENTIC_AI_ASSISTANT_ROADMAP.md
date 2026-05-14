# Donnit Agentic AI Assistant Roadmap

Last updated: 2026-05-13

## Product Thesis

Donnit should eventually support a role-aware AI assistant that can be assigned bounded work by each user. The assistant should not be a generic chatbot sitting beside the product. It should operate inside Donnit's task, agenda, approval, and Position Profile model so every completed assistant action strengthens workforce continuity.

The assistant's value is highest when it can:

- reduce manager/user admin work,
- draft useful outputs from existing task/email/profile context,
- ask clarifying questions instead of guessing,
- complete approved tool actions,
- report back into the task record,
- update Position Profile memory when the work teaches repeatable role knowledge.

## Donnit AI Task Worker Plan

### Product Behavior

Users should be able to assign simple, bounded work to **Donnit AI** from a task. Donnit AI should learn from prior task completions and Position Profile memory, perform safe internal work, ask for approval before any write or external send, then notify the user when the result is ready.

Users should also be able to start this flow directly from chat with a command:

```text
/donnit complete the weekly vendor reconciliation
/donnit send the standard onboarding follow-up to the new hire
/donnit draft the board meeting scheduling reply
```

The command means: "Create or locate the task, match it to a learned workflow if possible, and assign the execution attempt to Donnit AI." It should not mean "blindly do whatever was typed." Donnit must still check whether the workflow exists, whether required tools are connected, whether external writes are allowed, and whether the action needs approval.

The first useful workflow:

1. User opens a task and selects `Assign to Donnit AI`.
2. Donnit AI reads the task, subtasks, notes, attachments metadata, recent events, and related Position Profile memory.
3. Donnit AI decides whether it can proceed or needs clarification.
4. Donnit AI creates a short plan and result draft.
5. User approves any write/action.
6. Donnit AI posts the outcome back to the task log and sends a bell notification.
7. If the work reveals repeatable know-how, Donnit AI creates a Position Profile memory candidate for admin/owner review.

### Tools Required

Internal Donnit tools:

- `get_task(task_id)` - read title, due date, urgency, owner, notes, recurrence, visibility, and profile.
- `list_subtasks(task_id)` - read checklist state.
- `list_task_events(task_id)` - read task history, update requests, prior assistant runs.
- `get_position_profile(profile_id)` - read role owner, recurring work, how-to memory, tools, and historical tasks.
- `search_position_memory(profile_id, query)` - retrieve relevant prior completion instructions.
- `create_task_note(task_id, note)` - permission-gated write.
- `create_subtasks(task_id, subtasks)` - permission-gated write.
- `complete_task(task_id, note)` - permission-gated write.
- `create_notification(user_id, payload)` - system write after assistant state changes.
- `create_profile_memory_candidate(profile_id, candidate)` - permission-gated or admin-review write.
- `find_learned_workflow(org_id, profile_id, task_text)` - match a task against approved repeatable workflows.
- `get_workflow(workflow_id)` - read workflow steps, required tools, required approvals, examples, and last successful run.
- `create_workflow_candidate(profile_id, task_id, evidence)` - propose a learned workflow from repeated task completion patterns.
- `start_ai_task_run(task_id, workflow_id, instruction)` - create the durable assistant run.

External tools, later:

- Gmail via existing Google integration or Composio: draft/send email, with send always approval-gated.
- Slack via Slack bot/Composio: draft/send message, with send always approval-gated.
- Calendar via Google Calendar: propose/schedule blocks, with calendar write approval-gated.
- Browser/research tooling: future only, disabled for first customer unless explicitly approved.
- Voice input through Wispr/Whisper Flow or a similar dictation layer: convert speech to text, then feed the resulting text into the same `/donnit` or normal task command router. Voice should not bypass Donnit's confirmation gates.

### Database Creation

Add Supabase tables:

- `donnit.ai_assistants`: workspace-level virtual assistants, including the default `Donnit AI`.
- `donnit.ai_task_runs`: one run per assigned task, with org, task, requester, assignee, status, provider, model, cost, started/completed timestamps.
- `donnit.ai_task_run_events`: step-by-step audit trail, including plan, tool call, observation, approval request, result, error.
- `donnit.ai_task_run_approvals`: pending/approved/denied write approvals.
- `donnit.ai_learnings`: reusable lessons learned from completed tasks, scoped to workspace and optionally Position Profile.
- `donnit.ai_workflows`: approved repeatable workflows Donnit can run again.
- `donnit.ai_workflow_steps`: ordered workflow steps with required tool, input schema, approval policy, and expected output.
- `donnit.ai_workflow_examples`: examples of user phrasing, completed task evidence, and successful outputs used for matching.
- `donnit.ai_workflow_runs`: workflow-specific run state linked to assistant runs.

Statuses:

- `queued`
- `reading_context`
- `needs_clarification`
- `awaiting_approval`
- `working`
- `completed`
- `failed`
- `cancelled`

### Implementation Sequence

1. **Foundation**
   - Create Supabase migration for AI assistant tables.
   - Seed one virtual user/assistant per workspace: `Donnit AI`.
   - Add server types and store methods for runs/events/approvals.

2. **Command Router**
   - Add `/donnit` command detection in chat.
   - Strip the command prefix before task extraction.
   - Route normal chat to task creation; route `/donnit` to task creation plus AI workflow matching.
   - If no matching learned workflow exists, ask whether the user wants to create/teach one.
   - If matching is low confidence, ask a clarifying question before creating the run.

3. **Task UI**
   - Add `Assign to Donnit AI` inside the task `...` menu.
   - Add an assistant status row in the task detail window.
   - Add notification on run completion, blocked state, or approval request.

4. **Read-Only Agent Run**
   - First skill: `task_execution_planner`.
   - Inputs: task context, subtasks, events, Position Profile memory.
   - Output: `can_execute`, `questions`, `plan`, `draft_result`, `recommended_writes`, `learning_candidate`.
   - No task mutation yet.

5. **Permission-Gated Writes**
   - Convert recommended writes into confirmation cards.
   - On approval, let Donnit add note/subtasks/complete task.
   - Log every approved/denied action.

6. **Learning Loop**
   - When tasks are completed, detect simple repeatable patterns.
   - Save learning candidates tied to the Position Profile.
   - Show accepted learning under profile `Instructions` and `Recurring Work`.
   - Promote a learning candidate into an approved workflow only after enough evidence or explicit user/admin teaching.

7. **External Tool Pilot**
   - Start with Gmail draft only.
   - Next Slack draft.
   - Then Calendar scheduling.
   - Keep all sends/writes approval-gated.

8. **Voice Input**
   - Treat voice as an input method, not a separate intelligence layer.
   - Let users dictate normal tasks or `/donnit` commands through Wispr/Whisper Flow or similar.
   - Later, add native voice capture if the mobile app requires it.

9. **Provider Expansion**
   - Keep OpenAI as first production provider.
   - Add Hermes behind `AgentProvider` only after the Donnit-owned permission, logging, and memory model is stable.
   - Hermes may propose actions; Donnit remains the authority that executes or rejects them.

### Repeat Recognition and Hermes

The repeat-recognition problem is not just "does this task recur weekly?" It is: "Have we learned enough about how this role completes this type of work to safely ask Donnit AI to repeat it?"

Recommended approach:

1. Donnit-owned deterministic layer first:
   - extract task title, source, profile, recurrence, subtasks, notes, completion artifacts, and tool usage;
   - cluster similar tasks within the same Position Profile;
   - require repeated evidence before suggesting a workflow;
   - store learned workflows in Supabase with explicit approval state.

2. LLM semantic matching second:
   - use embeddings/semantic search to match new instructions to approved workflows;
   - use OpenAI reasoning to decide whether the new task is close enough to reuse the workflow;
   - ask a clarification question when confidence is low.

3. Hermes as optional workflow/skill engine:
   - use Hermes for procedural skill generation and self-improvement experiments;
   - isolate Hermes by workspace/profile;
   - never let Hermes execute production writes directly;
   - Hermes should return proposed workflow steps/tool calls to Donnit, and Donnit should enforce permissions.

Hermes is promising because its skill system maps well to repeatable procedural work, but the production source of truth must remain Donnit's workflow tables and audit logs.

### MVP Boundary

For first customer readiness, Donnit AI should not autonomously send external messages or perform irreversible actions. The high-value MVP is:

- assign task to Donnit AI,
- generate a useful plan/result from existing context,
- ask clarifying questions when needed,
- request approval for any task mutation,
- notify user when complete,
- preserve the learning in the task/profile record.

The next build slice should be:

1. `/donnit` command routing in chat. Status 2026-05-13: ready to test for internal read-only automation. `/donnit ...` creates a normal task, runs the task-update assistant, logs the run, and surfaces a notification when finished.
2. Learned workflow table/schema.
3. Read-only matching of `/donnit` task text to learned workflows.
4. If matched, create an assistant run in `queued/running`.
5. When finished, create a bell notification and task event.
6. Keep all external sends and task completion writes approval-gated until the workflow proves reliable.

## Hermes Assessment

Hermes Agent by Nous Research appears to be a viable agent runtime candidate, but it should not replace Donnit's application brain. Based on official Nous/Hermes materials, Hermes is positioned as a persistent, self-improving agent with memory, skills, scheduling, messaging gateways, browser/tool execution, subagents, and multiple model providers.

Useful Hermes capabilities for Donnit:

- Persistent memory and skill creation map well to Donnit's Position Profile memory concept.
- Tool execution and subagents could support bounded assistant tasks.
- Messaging gateways align with Slack/SMS/email assistant workflows.
- OpenAI-compatible/custom provider support could keep Donnit's model policy flexible.
- Self-hosting could become attractive for enterprise/privacy-sensitive customers.

Risks:

- Donnit is a multi-tenant SaaS. Hermes is often described as a persistent personal/server agent, so workspace isolation must be designed by Donnit, not assumed.
- Self-improving skills are powerful but risky in enterprise SaaS. Skills need admin approval, versioning, audit logs, and per-workspace isolation.
- Tool execution can create trust problems if writes/sends happen without explicit confirmation.
- Hermes may add operational complexity before the MVP proves core value.
- Donnit already has an emerging tool registry, observability, model policy, Composio connector, and OpenAI path. Hermes should be introduced behind this layer, not wired directly to the UI.

Recommendation:

Use Donnit's own agent controller as the product-facing layer. Treat Hermes as an optional execution/runtime provider behind a stable Donnit `AgentProvider` interface. This keeps Donnit portable: OpenAI-only agent loop first, Hermes later, Composio tools behind permission gates.

## Architecture Direction

### Donnit-Owned Layer

Donnit should own:

- task state,
- permissions,
- workspace isolation,
- role/Position Profile scope,
- confirmation prompts,
- audit logs,
- cost logs,
- tool schemas,
- context provider,
- task/profile memory updates,
- user-facing assistant status.

### Provider Layer

Provider options:

- `openai`: first implementation, easiest to ship inside current Vercel/Supabase app.
- `hermes`: optional runtime provider for longer-running tasks, memory/skills experiments, and self-hosted/enterprise deployments.
- `composio`: tool bridge for Gmail, Slack, calendar, and future workplace apps.

The product should call a Donnit-owned interface:

```ts
type AgentProvider = "openai" | "hermes";

type AssistantRunRequest = {
  orgId: string;
  userId: string;
  taskId: string;
  positionProfileId?: string | null;
  instruction: string;
  allowedTools: string[];
  writePolicy: "confirm_before_write";
  correlationId: string;
};
```

## Implementation Roadmap

### Phase 1: Assistant Foundations

Goal: make Donnit assignable to bounded work without external writes.

Build:

- `assistant_runs` table: run id, org, user, task, status, instruction, provider, cost, timestamps.
- `assistant_run_events` table: plan, tool call, observation, user approval request, result, error.
- Feature flag: `assistant_runs_enabled`.
- Backend endpoint: `POST /api/tasks/:id/assistant-runs`.
- First assistant skill: `draft_task_update`.
- Read-only tool set: get task, get subtasks, get task events, get Position Profile memory, get related email suggestion if linked.
- Output: proposed task update, suggested subtasks, blockers, confidence, profile-memory candidate.

Acceptance:

- User can ask Donnit AI to draft an update for a task.
- Donnit reads existing context and returns a structured report.
- No external messages are sent.
- No task/profile mutation happens without confirmation.

### Phase 2: Task-Owned Assistant Work

Goal: make assistant work visible inside the task profile.

Build:

- Task detail assistant section: status, latest report, requested approvals.
- Events: assistant_started, assistant_reported, assistant_blocked, assistant_completed.
- Add "assign to Donnit AI" as a backend capability before exposing a broad UI.
- Add notification when an assistant run finishes.
- Store assistant output as task event and optional task note.

Acceptance:

- Assistant report is visible in task history.
- Manager/admin can audit who asked the assistant to do what.
- Assistant can mark itself blocked with a clear missing requirement.

### Phase 3: Permission-Gated Writes

Goal: allow useful actions while protecting trust.

Build write tools:

- create suggested subtasks,
- update task notes,
- prepare email draft,
- prepare Slack reply,
- propose calendar block,
- propose Position Profile memory update.

Rules:

- Reads may run autonomously.
- Writes produce confirmation cards.
- External sends require explicit user approval every time in v1.
- Profile memory writes require approval if they alter recurring responsibilities, how-to instructions, access inventory, or confidential context.

Acceptance:

- Assistant can prepare work and ask for approval.
- User can approve/deny each write.
- All approvals are logged.

### Phase 4: Hermes Provider Pilot

Goal: test Hermes as an optional backend for longer-running assistant runs.

Build:

- `AgentProvider` interface with OpenAI provider first.
- Hermes provider adapter behind feature flag.
- Workspace-level provider config: disabled/openai/hermes.
- Hermes run adapter that sends task context, allowed tools, and write policy.
- Sandbox rule: Hermes cannot call production write APIs directly. It must return proposed tool calls to Donnit for permission enforcement.

Acceptance:

- One internal workspace can route assistant runs to Hermes.
- Hermes can draft a task update from Donnit context.
- Hermes cannot bypass Donnit permissions.
- Run logs show provider, tool calls, latency, and result.

### Phase 5: Workspace Learning

Goal: make the assistant continually learn without polluting or leaking memory.

Build:

- Workspace-scoped assistant memory.
- Position Profile-scoped memory candidates.
- Admin review queue for high-impact learned knowledge.
- Skill/version registry if Hermes-generated skills are adopted.
- Memory expiration and correction path.

Acceptance:

- Each workspace has isolated assistant memory.
- Position Profile knowledge improves through completed work.
- Admin can accept/reject learned recurring responsibilities and how-to notes.

## First Customer Recommendation

Do not ship autonomous Hermes execution for the first Friday customer. Ship the story as:

- Donnit AI already interprets chat/email/Slack into tasks.
- Agentic assistant is next: first bounded skill will draft task updates and handoff context from existing Donnit memory.
- External tool execution will remain permission-gated.

The safest first implementation is OpenAI-powered assistant runs inside Donnit. Hermes should be tested internally after the first customer onboarding, then piloted as an optional provider once we prove the assistant workflow creates value.

## Reference Links

- Nous Research Hermes Agent: https://nousresearch.com/hermes-agent/
- Hermes Agent docs: https://hermes-agent.nousresearch.com/docs/
- Hermes Agent GitHub: https://github.com/NousResearch/hermes-agent
