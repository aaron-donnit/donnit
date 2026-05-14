# Donnit Starter Memory

Last updated: 2026-05-14

This is the global operating memory Donnit should load for every workspace before customer-specific memory exists. It is not private client data and should not be written into a customer's Position Profile memory by default.

## Product Principle

Donnit now treats starter memory as layer zero of a broader task-resolution memory architecture. See `docs/intelligence/task-resolution-memory-architecture.md`.

Donnit should reason through six practical memory layers:

- **Starter memory**: global product behavior. It teaches Donnit how to interpret work, route tasks, speak naturally, use agenda, use notifications, and protect privacy.
- **Workspace memory**: customer-specific behavior. It teaches Donnit local vocabulary, people aliases, profile nicknames, department shorthand, recurring workflows, and company preferences.
- **User memory**: user-specific preferences. It teaches Donnit how an individual likes timing, reminders, agenda blocks, and confirmations handled.
- **Position Profile memory**: role-specific institutional knowledge. It preserves recurring responsibilities, how-to notes, tools, stakeholders, critical dates, risks, and historical task evidence.
- **Session memory**: short-term conversation context. It stores pending task drafts, unresolved clarifying questions, recent entities, and user replies so Donnit does not lose the thread between turns.
- **Action memory**: task/event history. It stores what was created, changed, accepted, rejected, completed, corrected, or deferred so future routing can improve from actual behavior.

Starter memory should never be asked to do the whole job alone. It should guide behavior, but task creation needs a resolution pipeline that retrieves actual workspace candidates, scores confidence, asks when the answer is unclear, and writes corrections back into memory.

## Perplexity Memory Review Takeaways

The Perplexity review reinforced the correct product architecture: Donnit needs a global baseline plus isolated workspace learning. The useful additions are:

- a clear memory precedence order: conversation, user, workspace, Position Profile, global;
- an intent map that can split one message into multiple actions;
- universal phrase families for assignment, delegation, scheduling, follow-up, recording, escalation, and status updates;
- business title interpretation so role words become routing clues without inventing people;
- scheduling constraint language such as "after lunch", "not before noon", "quick sync", and "working session";
- watcher/information-only signals such as FYI, CC, and loop in;
- scoped write-back rules so learned people, aliases, policies, and workflows stay inside the customer workspace.

What Donnit should avoid: turning every possible phrase into a giant static prompt. Starter memory should hold compact universal rules. Workspace memory should hold customer-specific facts and corrections. Position Profile memory should hold role procedures and task memory.

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
- `memory_layers.scope_precedence`
- `memory_layers.write_to_correct_scope`
- `memory_layers.conflict_resolution`
- `intent.multi_action_map`
- `task_interpretation.clean_action`
- `task_interpretation.business_language`
- `task_interpretation.typo_tolerance`
- `task_interpretation.clarification_gate`
- `language.global_phrase_patterns`
- `task_interpretation.no_task_cases`
- `roles.business_title_interpretation`
- `assignment.explicit_owner`
- `assignment.watchers_and_information_only`
- `assignment.ambiguous_people`
- `assignment.delegation_collaboration_reassignment`
- `sources.email_to_task`
- `sources.slack_sms_document_to_task`
- `task_fields.baseline_required_fields`
- `task_fields.urgency_priority`
- `task_fields.time_and_recurrence`
- `scheduling.language_and_constraints`
- `status.status_update_language`
- `task_fields.privacy`
- `agenda.create_approve_export`
- `notifications.lifecycle`
- `position_profiles.role_routing`
- `position_profiles.active_profile_tags`
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

## Memory Reaction Principle

Donnit's reaction to a messy input should follow this sequence:

1. Parse the user's raw words without guessing.
2. Retrieve a short list of possible people, Position Profiles, aliases, templates, recurring duties, and recent session entities.
3. Resolve against only those candidates.
4. Assign confidence to each critical field.
5. Create the task only when confidence is high enough.
6. Ask one targeted clarifying question when a critical field is missing or ambiguous.
7. Store accepted corrections as workspace or Position Profile memory.

Example:

- Input: "assign the assistant with preparing the board packet by eod friday"
- Good behavior: resolve "assistant" from workspace alias memory, resolve "board packet" from procedural/profile memory, clean the title to "Prepare the board packet", set the due date to Friday at end of day, then create the task or disclose any inferred fields.
- Bad behavior: assign the task to the sender, copy the full sentence as the title, or invent a person/profile not present in workspace memory.

Second example:

- Input: "assign Nina the Manhattan projekt for next month"
- Good behavior: normalize "projekt" to "project", resolve Nina only if there is one clear active Nina, remove the vague date phrase from the title, and ask "What exact due date in next month should I use?"
- Bad behavior: copy the typo into the task, invent a date, or create the task without clarifying the deadline.

Third example:

- Input: "assign this to Jordan nect month"
- Good behavior: normalize "nect month" to "next month", resolve Jordan only if there is one clear active Jordan, recognize that "this" is not a real work item, and ask what Jordan should do before asking for the exact due date.
- Bad behavior: create a task titled "Jordan nect month" or ask the user to restate the whole request.

## What Comes Next

Current starter memory is static backend memory. The next product step is a workspace AI memory and task-resolution layer with:

- adding/editing workspace vocabulary;
- approving memory learned from clarification;
- archiving outdated workspace rules;
- showing which rules affected a task;
- preventing private/personal rules from leaking into role memory.
- maintaining pending task drafts across clarifying chat turns;
- logging candidate retrieval, confidence, final decisions, and corrections for every task resolution.

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
