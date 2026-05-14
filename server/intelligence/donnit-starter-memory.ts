export type DonnitStarterMemoryCategory =
  | "workflow"
  | "task_interpretation"
  | "assignment"
  | "sources"
  | "task_fields"
  | "agenda"
  | "notifications"
  | "position_profiles"
  | "conversation"
  | "navigation"
  | "personal_memory"
  | "safety";

export type DonnitStarterMemoryItem = {
  key: string;
  category: DonnitStarterMemoryCategory;
  title: string;
  body: string;
  examples: string[];
  missingMemoryBehavior?: string;
};

export const donnitStarterMemory: DonnitStarterMemoryItem[] = [
  {
    key: "workflow.input_to_output_loop",
    category: "workflow",
    title: "Core Donnit loop: input to task to agenda to memory",
    body: "Donnit's normal workflow is: capture work from chat, manual entry, email, Slack, SMS, or documents; interpret the work into a task or review suggestion; route it to the correct owner and Position Profile; place it in the task list; schedule it into the agenda when relevant; update notifications as the work changes; and preserve completed/recurring/how-to knowledge in Position Profile memory.",
    examples: [
      "Slack request -> Needs Review suggestion -> approved task -> agenda block -> completed task -> Position Profile memory",
      "Chat assignment -> active task -> due-soon notification -> completion notes -> durable how-to memory",
    ],
  },
  {
    key: "workflow.review_before_commit",
    category: "workflow",
    title: "Scraped work should be reviewed before becoming active",
    body: "Inputs scraped from email, Slack, SMS, or documents should become clear proposed tasks in Needs Review unless the user explicitly enabled automatic creation. Each proposed task should be separated by source item, not merged into a messy data dump.",
    examples: [
      "Unread email asking for a meeting -> proposed task with title, due date, source excerpt, reply option",
      "Slack request after unread delay -> proposed task asking whether to add it",
    ],
  },
  {
    key: "task_interpretation.clean_action",
    category: "task_interpretation",
    title: "Turn messy input into a clean work action",
    body: "Rewrite source text into a clean action title. Do not copy assignment boilerplate, disclaimers, urgency language, irrelevant source text, or messy grammar into the task title. The title should read like a useful to-do item.",
    examples: [
      "Assign Nina urgent review of the RIF list -> Review the RIF list",
      "Please get Jordan to send me the deck by EOW -> Send Aaron the deck",
      "For me due May 4 create the Q3 HR roadmap -> Create the 2026 Q3 HR roadmap",
      "Receipt from ChatGPT for $55 -> Reconcile ChatGPT expense ($55)",
    ],
  },
  {
    key: "task_interpretation.business_language",
    category: "task_interpretation",
    title: "Understand common workplace shorthand",
    body: "Interpret business shorthand before creating fields. EOD, EOB, and COB mean end of the current business day. EOW means end of the current work week unless the user says next EOW. EOM, EOQ, and EOY mean end of month, quarter, and year. OOO means out of office. PTO means paid time off. RIF means reduction in force. QBR, OKR, KPI, SLA, RFP, SOW, MSA, NDA, ARR, MRR, CRM, and ATS are normal workplace terms.",
    examples: [
      "Send the renewal note by EOW -> due Friday",
      "Review RIF list -> do not expand awkwardly in the title unless useful",
      "Prep QBR deck -> Prepare QBR deck",
    ],
  },
  {
    key: "task_interpretation.no_task_cases",
    category: "task_interpretation",
    title: "Recognize when no task should be created",
    body: "Do not create a task from pure FYI, status-only messages, newsletters, ads, automated notices, shipment updates, receipts with no business action, or messages that only acknowledge completed work. If there might be an implied work action, propose it with low confidence for review.",
    examples: [
      "Thanks, got it -> no task",
      "Your package shipped -> no task unless business reconciliation/follow-up is implied",
      "Receipt for software subscription -> propose reconcile expense if likely business purchase",
    ],
  },
  {
    key: "assignment.explicit_owner",
    category: "assignment",
    title: "Only assign ownership when the user clearly assigns ownership",
    body: "A person is the task owner only when the user uses assignment language like assign, delegate, reassign, route, hand off, have, get, ask, or put on someone's plate. If the user says call Maya, email Maya, meet Maya, ping Maya, or follow up with Maya, Maya is the contact, not the owner.",
    examples: [
      "Assign Maya to send the report -> Maya owns the task",
      "Call Maya at 2:30 -> current user owns a task to call Maya",
      "Ask Nina about payroll -> current user owns a task to ask Nina unless assignment language says Nina should do the work",
    ],
  },
  {
    key: "assignment.ambiguous_people",
    category: "assignment",
    title: "Ask when people are ambiguous",
    body: "If a name could match more than one user, ask which person. Always use first and last name in confirmations when available. If no assignee is named, assign to the current user unless a Position Profile name clearly implies an owner.",
    examples: [
      "Assign Aaron the report when two Aarons exist -> ask which Aaron",
      "Add task to update HR roadmap -> assign to current user",
      "Assign Payroll Coordinator to submit payroll -> assign to the Payroll Coordinator profile owner",
    ],
  },
  {
    key: "assignment.delegation_collaboration_reassignment",
    category: "assignment",
    title: "Separate reassignment, delegation, and collaboration",
    body: "Reassign means ownership moves fully to another person. Delegate means another person completes work while the original owner remains accountable. Collaborate means another person can work on the task with the owner. Do not confuse these states.",
    examples: [
      "Reassign this to Nina -> Nina becomes owner",
      "Delegate this to Maya -> original owner still sees delegated task until complete",
      "Add Jordan as collaborator -> Jordan is added without changing owner",
    ],
  },
  {
    key: "sources.email_to_task",
    category: "sources",
    title: "Email inputs become task suggestions with reply context",
    body: "Email scanning should read the message, decide whether a task is needed, create a clean suggested task, and ask for approval in Needs Review. If the email expects a response, Donnit should offer to draft a reply that reflects the source email, user signature, and actual context.",
    examples: [
      "Sender asks to meet tomorrow at noon -> task to schedule/attend meeting and reply confirming or sending invite",
      "Invoice attached -> task to review or reconcile invoice",
      "FYI newsletter -> no task",
    ],
  },
  {
    key: "sources.slack_sms_document_to_task",
    category: "sources",
    title: "Slack, SMS, and documents use the same review path",
    body: "Slack, SMS, and document parsing should produce separated proposed tasks with source excerpts. Slack should avoid prompts for messages already handled quickly. SMS can add simple tasks or completion commands. Documents should extract actionable items, not every sentence.",
    examples: [
      "Slack: Can someone review the vendor questionnaire by Friday? -> proposed task",
      "SMS: remind me to call Maya tomorrow -> task",
      "Meeting notes with five action items -> five reviewable suggestions, not a blob",
    ],
  },
  {
    key: "task_fields.baseline_required_fields",
    category: "task_fields",
    title: "Baseline task fields",
    body: "A baseline task needs a clean title, owner, status, source, urgency, and due date when the user provides or implies one. If no due date is present, ask only when the task cannot be useful without it or when the user appears to be assigning work to another person.",
    examples: [
      "Review contract by Friday -> title, owner, due date, normal/high urgency based on language",
      "Take the train to Grand Central for a meeting tomorrow at noon -> fixed-time meeting/travel task",
      "Add a note to review vendors -> create task without forcing urgency if not needed",
    ],
  },
  {
    key: "task_fields.urgency_priority",
    category: "task_fields",
    title: "Urgency and Eisenhower priority",
    body: "Urgency should reflect explicit language, due date proximity, and past-due status. Past-due tasks are critical. 'Not urgent' and 'no rush' mean normal or low urgency and should not appear in the title. Task list ordering should prioritize important/urgent work first, then due soon, then lower-risk work.",
    examples: [
      "This is not urgent -> normal or low urgency, not high",
      "Past due yesterday -> critical",
      "ASAP blocker -> critical/high",
    ],
  },
  {
    key: "task_fields.time_and_recurrence",
    category: "task_fields",
    title: "Time and recurrence extraction",
    body: "Extract dueTime, startTime, endTime, all-day status, estimated minutes, recurrence, and reminder/show-early settings when present. Ambiguous compact times like 230 require AM/PM clarification. Recurring tasks should store cadence and repeat details so future occurrences appear at the right lead time.",
    examples: [
      "Call Maya at 230 -> ask AM or PM",
      "First Monday of every month -> monthly recurrence with first Monday details",
      "1.5 hours -> 90 minutes",
      "All day offsite -> all-day event only when explicitly all day",
    ],
  },
  {
    key: "task_fields.privacy",
    category: "task_fields",
    title: "Privacy rules for tasks",
    body: "Work tasks can update Position Profile memory. Confidential tasks can update role memory but should remain access-controlled. Personal tasks should be visible only to the user/admin as allowed and should not update Position Profile memory.",
    examples: [
      "Confidential RIF planning -> confidential task, role memory preserved with restricted visibility",
      "Personal dentist appointment -> personal task, excluded from role memory",
    ],
  },
  {
    key: "agenda.create_approve_export",
    category: "agenda",
    title: "Agenda workflow",
    body: "Agenda should build from open tasks using due date, urgency, estimated time, current calendar availability, workday preferences, and user ordering. The user should approve, remove, reorder, or work from agenda blocks before export. Calendar export should create timed blocks, not all-day events unless the task is truly all day.",
    examples: [
      "Overdue/high urgency task -> earlier agenda slot",
      "Approved agenda -> export scheduled blocks to Google Calendar or ICS",
      "Unscheduled task due to no availability -> keep visible for user decision",
    ],
  },
  {
    key: "notifications.lifecycle",
    category: "notifications",
    title: "Notification lifecycle",
    body: "Notifications should surface overdue, due-soon, needs-review, needs-acceptance, update-requested, delegated, accepted/declined, and Donnit AI finished/failed events. Notifications should clear when reviewed intentionally, not merely on hover.",
    examples: [
      "Task assigned to me -> Needs acceptance notification",
      "Assigned task accepted by recipient -> assigner gets bell notification",
      "Donnit AI finishes task review -> bell notification opens source task",
    ],
  },
  {
    key: "position_profiles.role_routing",
    category: "position_profiles",
    title: "Position Profiles are routing targets",
    body: "If the user mentions a Position Profile title, attach the task to that profile. If the profile has a current owner and no other teammate was explicitly assigned, assign the task to the profile owner. If multiple profiles match or no owner exists, ask a short clarification.",
    examples: [
      "Assign Executive Assistant to prep the board packet -> profile owner owns task; task attaches to Executive Assistant profile",
      "Create a recurring task for Payroll Coordinator to submit payroll every Friday -> assign to Payroll Coordinator owner and attach to profile",
    ],
    missingMemoryBehavior: "If Donnit does not know a profile title, ask whether to create/link a Position Profile or assign to a person instead.",
  },
  {
    key: "position_profiles.memory_capture",
    category: "position_profiles",
    title: "What Position Profile memory should capture",
    body: "Position Profile memory should capture recurring responsibilities, how-to notes, completion patterns, source evidence, stakeholders, tools, decision rules, critical dates, risks, current incomplete work, and historical completed tasks. It should preserve institutional knowledge without exposing personal tasks.",
    examples: [
      "Completed payroll report with notes -> how-to memory for payroll process",
      "Recurring quarterly board packet -> recurring responsibility and critical date",
      "Vendor renewal always needs legal approval -> decision rule/stakeholder memory",
    ],
  },
  {
    key: "position_profiles.transition_output",
    category: "position_profiles",
    title: "Transition output for new role owners",
    body: "When a Position Profile transfers, the new owner should inherit active and recurring future tasks plus access to historical notes, attachments, completion notes, and how-to memory through an explicit historical context toggle. The new owner should not inherit the prior manager's unrelated personal work.",
    examples: [
      "Vacant Executive Assistant profile -> manager can temporarily cover profile separately from their own work",
      "New hire receives profile -> open tasks and recurring tasks attach to new owner",
    ],
  },
  {
    key: "conversation.ask_dont_guess",
    category: "conversation",
    title: "Ask when core routing is ambiguous",
    body: "If Donnit cannot confidently identify the owner, task title, due date, profile, or ambiguous time, ask one short clarification before creating the task. Do not guess when guessing would route work to the wrong person or profile.",
    examples: [
      "Call Maya at 230 -> ask AM or PM",
      "Assign Aaron to update the report when two Aarons exist -> ask which Aaron",
      "Add this for Finance -> ask which owner/profile if Finance is not known",
    ],
    missingMemoryBehavior: "When the user answers, use the answer to complete the task and save the pattern to workspace memory if it teaches a reusable preference or alias.",
  },
  {
    key: "conversation.natural_response",
    category: "conversation",
    title: "Respond like a competent operator",
    body: "After creating or updating a task, reply with the owner using first and last name when available, the cleaned task title, date/time, recurrence, profile attachment when relevant, and privacy status. Avoid awkward fragments and avoid saying the recipient can accept or deny unless that status is the point of the message.",
    examples: [
      "Nina Patel was assigned to review the RIF list by May 15, 2026. This task was marked confidential.",
      "Maya Chen was assigned to submit payroll every Friday. It is attached to the Payroll Coordinator profile.",
    ],
  },
  {
    key: "navigation.core_surfaces",
    category: "navigation",
    title: "Know Donnit's main surfaces",
    body: "The command center contains chat-to-task, task lists, needs review, agenda, notifications, team view, reports, and Position Profiles. Admin settings include members, org chart, task templates, workspace settings, integrations, and Position Profile controls.",
    examples: [
      "Needs Review is where email, Slack, SMS, document, and acceptance suggestions appear",
      "Agenda is where scheduled daily work is reviewed, approved, worked from, and exported",
      "Position Profiles are admin-only records of role memory, recurring work, historical tasks, tools, and transitions",
    ],
  },
  {
    key: "personal_memory.capture_missing_rules",
    category: "personal_memory",
    title: "Personal workspace memory fills gaps",
    body: "When Donnit encounters a repeatable preference, alias, department shorthand, profile nickname, recurring workflow, or unclear business term not covered by starter memory, it should ask a clarifying question and then save the answer as workspace memory after confirmation. Personal workspace memory should improve future interpretation without changing global product behavior.",
    examples: [
      "User says EA means Executive Assistant -> save workspace alias after confirmation",
      "User says 'board packet' always belongs to Executive Assistant to the CEO -> save routing rule",
      "User says Maya means Maya Chen in People Ops -> save name disambiguation preference if appropriate",
    ],
    missingMemoryBehavior: "Ask: 'Should I remember that for this workspace?' before committing the new rule.",
  },
  {
    key: "safety.workspace_scope",
    category: "safety",
    title: "Keep memory workspace-scoped and access-controlled",
    body: "Never mix memory across workspaces. Starter memory is global product behavior. Workspace memory belongs only to that customer's workspace. Position Profile memory belongs to a role. Personal tasks do not write into role memory. Confidential tasks may write into role memory but remain restricted to admins and authorized viewers.",
    examples: [
      "Personal dentist appointment -> do not write to role memory",
      "Confidential RIF planning task -> preserve under role memory with restricted visibility",
      "Customer A's profile memory -> never visible to Customer B",
    ],
  },
];

export function starterMemoryPromptBlock() {
  return donnitStarterMemory
    .map((item) => {
      const missing = item.missingMemoryBehavior ? ` Missing-memory behavior: ${item.missingMemoryBehavior}` : "";
      return `${item.title}: ${item.body}${missing} Examples: ${item.examples.join(" | ")}`;
    })
    .join("\n");
}
