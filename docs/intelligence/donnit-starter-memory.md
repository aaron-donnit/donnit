# Donnit Starter Memory

Last updated: 2026-05-14

This is the global operating memory Donnit should load for every workspace before customer-specific memory exists. It is not private client data and should not be written into a customer's Position Profile memory by default.

## Product Principle

Donnit has two memory layers:

- **Starter memory**: global product behavior. It teaches Donnit how to interpret work, route tasks, speak naturally, use agenda, use notifications, and protect privacy.
- **Workspace memory**: customer-specific behavior. It teaches Donnit local vocabulary, people aliases, profile nicknames, department shorthand, recurring workflows, and company preferences.
- **Position Profile memory**: role-specific institutional knowledge. It preserves recurring responsibilities, how-to notes, tools, stakeholders, critical dates, risks, and historical task evidence.

## Core Workflow Audit

The base Donnit loop is:

1. Capture input from chat, manual task entry, email, Slack, SMS, or document upload.
2. Decide whether the input is actionable, context-only, or needs review.
3. Convert actionable input into a clean task with owner, due date/time, urgency, source, privacy, recurrence, and Position Profile when known.
4. Put external/scraped suggestions in Needs Review unless automatic creation is enabled.
5. Put approved/created tasks into the task list.
6. Build agenda from open tasks using due date, urgency, time estimate, user order, availability, and calendar constraints.
7. Notify users about overdue work, due-soon work, acceptance, delegation, update requests, and Donnit AI completion.
8. Capture task events, completion notes, recurring duties, and assistant learnings into Position Profile memory.
9. Use Position Profile memory to improve future task routing, handoffs, and role continuity.

## Starter Memory Coverage

The backend seed in `server/intelligence/donnit-starter-memory.ts` covers:

- `workflow.input_to_output_loop`
- `workflow.review_before_commit`
- `task_interpretation.clean_action`
- `task_interpretation.business_language`
- `task_interpretation.no_task_cases`
- `assignment.explicit_owner`
- `assignment.ambiguous_people`
- `assignment.delegation_collaboration_reassignment`
- `sources.email_to_task`
- `sources.slack_sms_document_to_task`
- `task_fields.baseline_required_fields`
- `task_fields.urgency_priority`
- `task_fields.time_and_recurrence`
- `task_fields.privacy`
- `agenda.create_approve_export`
- `notifications.lifecycle`
- `position_profiles.role_routing`
- `position_profiles.memory_capture`
- `position_profiles.transition_output`
- `conversation.ask_dont_guess`
- `conversation.natural_response`
- `navigation.core_surfaces`
- `personal_memory.capture_missing_rules`
- `safety.workspace_scope`

## Personal Workspace Memory Behavior

When Donnit encounters something that starter memory does not explain, it should:

1. Recognize uncertainty.
2. Ask one short clarifying question.
3. Complete the immediate task after the user answers.
4. Ask whether to remember the rule for this workspace when the answer is reusable.
5. Store it as workspace memory, not global starter memory.

Examples:

- "EA" means "Executive Assistant to the CEO" in this workspace.
- "Board packet" should route to the Executive Assistant Position Profile.
- "People Ops" is the same group as HR.
- "Maya" means Maya Chen unless another Maya is added later.
- "Monthly close" tasks should attach to the Finance Coordinator profile.

## What Comes Next

Current starter memory is static backend memory. The next product step is a workspace AI memory table and UI/admin controls for:

- adding/editing workspace vocabulary;
- approving memory learned from clarification;
- archiving outdated workspace rules;
- showing which rules affected a task;
- preventing private/personal rules from leaking into role memory.

## Eval Harness

Donnit now has a deterministic task-intelligence eval harness in `server/task-intelligence-evals.test.ts`.

The first eval set covers:

- explicit person assignment;
- Position Profile title routing;
- Position Profile alias routing such as assistant/EA;
- contact tasks that should stay self-owned;
- ambiguous compact times;
- confidential tasks;
- first-name collisions;
- time estimates;
- personal task exclusion from role memory;
- profile shorthand such as sales.

Every user-reported prompt failure should be added to this eval set before or during the fix. The eval set separates two failure types:

- **memory coverage failures**: Donnit does not know a phrase, alias, workflow, or expected outcome.
- **memory application failures**: Donnit has the rule, but deterministic routing or prompt usage does not apply it.
