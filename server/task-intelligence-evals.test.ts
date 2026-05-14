import { describe, expect, it, vi } from "vitest";

import { __chatParserTest } from "./routes";

const members = [
  { user_id: "user-aaron", profile: { full_name: "Aaron Hassett", email: "aaron@rosterstack.com" } },
  { user_id: "user-aaron-b", profile: { full_name: "Aaron Blake", email: "aaron.blake@example.com" } },
  { user_id: "user-nina", profile: { full_name: "Nina Patel", email: "nina@example.com" } },
  { user_id: "user-maya", profile: { full_name: "Maya Chen", email: "maya@example.com" } },
  { user_id: "user-jordan", profile: { full_name: "Jordan Lee", email: "jordan@example.com" } },
];

const profiles = [
  {
    id: "profile-ea",
    title: "Executive Assistant to the CEO",
    current_owner_id: "user-jordan",
    temporary_owner_id: null,
    delegate_user_id: null,
  },
  {
    id: "profile-payroll",
    title: "Payroll Coordinator",
    current_owner_id: "user-nina",
    temporary_owner_id: null,
    delegate_user_id: null,
  },
  {
    id: "profile-sales",
    title: "Sales Manager",
    current_owner_id: "user-maya",
    temporary_owner_id: null,
    delegate_user_id: null,
  },
  {
    id: "profile-recruiting",
    title: "Recruiting Coordinator",
    current_owner_id: "user-jordan",
    temporary_owner_id: null,
    delegate_user_id: null,
  },
  {
    id: "profile-recruiting-manager",
    title: "Recruiting Manager",
    current_owner_id: "user-nina",
    temporary_owner_id: null,
    delegate_user_id: null,
  },
] as never;

const profilesWithClientSuccess = [
  ...profiles,
  {
    id: "profile-client-success",
    title: "Client Success Specialist",
    current_owner_id: "user-maya",
    temporary_owner_id: null,
    delegate_user_id: null,
  },
] as never;

const profilesWithContestedClientSuccess = [
  ...profilesWithClientSuccess,
  {
    id: "profile-client-success-manager",
    title: "Client Success Manager",
    current_owner_id: "user-nina",
    temporary_owner_id: null,
    delegate_user_id: null,
  },
] as never;

const profilesWithFinanceIntern = [
  ...profiles,
  {
    id: "profile-finance-intern",
    title: "Finance Intern",
    current_owner_id: "user-nina",
    temporary_owner_id: null,
    delegate_user_id: null,
  },
] as never;

const profilesWithTwoFinanceProfiles = [
  ...profilesWithFinanceIntern,
  {
    id: "profile-finance-analyst",
    title: "Finance Analyst",
    current_owner_id: "user-jordan",
    temporary_owner_id: null,
    delegate_user_id: null,
  },
] as never;

const profilesWithVacantFinanceIntern = [
  ...profiles,
  {
    id: "profile-finance-intern",
    title: "Finance Intern",
    status: "vacant",
    current_owner_id: null,
    temporary_owner_id: null,
    delegate_user_id: null,
  },
] as never;

const profilesWithCoveredFinanceIntern = [
  ...profiles,
  {
    id: "profile-finance-intern",
    title: "Finance Intern",
    status: "covered",
    current_owner_id: "user-jordan",
    temporary_owner_id: null,
    delegate_user_id: "user-nina",
  },
] as never;

const profilesWithMultipleInterns = [
  ...profilesWithFinanceIntern,
  {
    id: "profile-marketing-intern",
    title: "Marketing Intern",
    current_owner_id: "user-maya",
    temporary_owner_id: null,
    delegate_user_id: null,
  },
] as never;

const workspaceAlias = (overrides: {
  id: string;
  surfaceForm: string;
  targetType?: string;
  targetId: string;
  scopeType?: string;
  scopeId?: string | null;
  confidence?: number;
  source?: string;
  lastUsedAt?: string;
}) => ({
  id: overrides.id,
  org_id: "org-1",
  surface_form: overrides.surfaceForm,
  normalized_form: overrides.surfaceForm.toLowerCase(),
  target_type: overrides.targetType ?? "position_profile",
  target_id: overrides.targetId,
  scope_type: overrides.scopeType ?? "workspace",
  scope_id: overrides.scopeId ?? null,
  scope_key: overrides.scopeId ?? overrides.scopeType ?? "workspace",
  confidence_score: overrides.confidence ?? 0.65,
  status: "active",
  source: overrides.source ?? "learned:chat_resolution",
  usage_count: 1,
  contradicted_count: 0,
  last_used_at: overrides.lastUsedAt ?? "2026-05-14T14:00:00.000Z",
  contested_at: null,
  metadata: {},
  created_by: "user-aaron",
  created_at: overrides.lastUsedAt ?? "2026-05-14T14:00:00.000Z",
  updated_at: overrides.lastUsedAt ?? "2026-05-14T14:00:00.000Z",
  archived_at: null,
}) as never;

const assistantAliasConflict = [
  workspaceAlias({
    id: "alias-workspace-assistant",
    surfaceForm: "assistant",
    targetId: "profile-ea",
    scopeType: "workspace",
    confidence: 0.95,
    source: "system:position_profile_title_tag",
    lastUsedAt: "2026-05-14T09:00:00.000Z",
  }),
  workspaceAlias({
    id: "alias-user-assistant",
    surfaceForm: "assistant",
    targetId: "profile-payroll",
    scopeType: "user",
    scopeId: "user-aaron",
    confidence: 0.7,
    source: "user_confirmed",
    lastUsedAt: "2026-05-14T09:00:00.000Z",
  }),
] as never;

const opsAliasRecencyConflict = [
  workspaceAlias({
    id: "alias-ops-old",
    surfaceForm: "ops",
    targetId: "profile-sales",
    confidence: 0.95,
    source: "user_confirmed",
    lastUsedAt: "2026-01-10T09:00:00.000Z",
  }),
  workspaceAlias({
    id: "alias-ops-new",
    surfaceForm: "ops",
    targetId: "profile-payroll",
    confidence: 0.55,
    source: "user_confirmed",
    lastUsedAt: "2026-05-14T09:00:00.000Z",
  }),
] as never;

type EvalExpected = Partial<ReturnType<typeof __chatParserTest.evaluateDeterministicChatTask>> & {
  titleIncludes?: string;
  titleExcludes?: string[];
};

const evalCases: Array<{
  name: string;
  message: string;
  expected: EvalExpected;
  profilesOverride?: typeof profiles;
  aliasesOverride?: ReturnType<typeof workspaceAlias>[];
}> = [
  {
    name: "assigns explicit person and rewrites me",
    message: "assign Nina to send me a payroll report by EOW",
    expected: {
      assignedToId: "user-nina",
      title: "Send Aaron a payroll report",
      dueDate: "2026-05-15",
      recurrence: "none",
    },
  },
  {
    name: "asks for scope and due date on typo-heavy vague meeting assignment",
    message: "have nina go through and compet all of our wok from the meeting",
    expected: {
      assignedToId: "user-nina",
      title: "Complete all of our work from the meeting",
      missing: ["title", "dueDate"],
      titleExcludes: ["compet", "wok"],
    },
  },
  {
    name: "normalizes project typo and asks for precise next-month due date",
    message: "assign nina the manhattan projekt for next month",
    expected: {
      assignedToId: "user-nina",
      title: "Manhattan project",
      missing: ["dueDatePrecision"],
      titleExcludes: ["projekt"],
    },
  },
  {
    name: "routes assistant alias to Executive Assistant profile owner",
    message: "assign the assistant with preparing the board packet by eod friday",
    expected: {
      assignedToId: "user-jordan",
      positionProfileId: "profile-ea",
      dueDate: "2026-05-15",
      title: "Prepare the board packet",
      titleExcludes: ["assistant with", "assign"],
    },
  },
  {
    name: "routes EA shorthand to Executive Assistant profile owner",
    message: "assign the EA to update the CEO briefing by EOD",
    expected: {
      assignedToId: "user-jordan",
      positionProfileId: "profile-ea",
      dueDate: "2026-05-14",
      title: "Update the CEO briefing",
    },
  },
  {
    name: "user scoped memory overrides workspace alias for that user",
    message: "assign the assistant to compile packets by EOW",
    aliasesOverride: assistantAliasConflict,
    expected: {
      assignedToId: "user-nina",
      positionProfileId: "profile-payroll",
      dueDate: "2026-05-15",
      title: "Compile packets",
    },
  },
  {
    name: "newer confirmed workspace memory beats older lower-recency memory",
    message: "assign ops to handle vendor intake by EOW",
    aliasesOverride: opsAliasRecencyConflict,
    expected: {
      assignedToId: "user-nina",
      positionProfileId: "profile-payroll",
      dueDate: "2026-05-15",
      title: "Vendor intake",
    },
  },
  {
    name: "routes recruiting shorthand to Recruiting Coordinator",
    message: "ask Recruiting Coordinator to schedule first round interviews by EOW",
    expected: {
      assignedToId: "user-jordan",
      positionProfileId: "profile-recruiting",
      dueDate: "2026-05-15",
      titleIncludes: "first round interviews",
    },
  },
  {
    name: "asks when a bare role alias is contested",
    message: "ask recruiting to schedule first round interviews by EOW",
    expected: {
      assignedToId: "user-aaron",
      missing: ["assignee", "positionProfile"],
      dueDate: "2026-05-15",
    },
  },
  {
    name: "routes profile title to current owner",
    message: "Assign Payroll Coordinator to submit payroll every Friday by EOD",
    expected: {
      assignedToId: "user-nina",
      positionProfileId: "profile-payroll",
      recurrence: "weekly",
      titleIncludes: "payroll",
    },
  },
  {
    name: "does not assign contact outreach to contact",
    message: "call Maya at noon tomorrow about the renewal packet",
    expected: {
      assignedToId: "user-aaron",
      title: "Call Maya about the renewal packet",
      dueDate: "2026-05-15",
      dueTime: "12:00",
    },
  },
  {
    name: "asks for compact time clarification",
    message: "call Maya at 230 tomorrow about the renewal packet",
    expected: {
      assignedToId: "user-aaron",
      missing: ["timeMeridiem"],
    },
  },
  {
    name: "keeps confidential task confidential",
    message: "please get nina to urgently take care of the RIF list by friday this is confidential",
    expected: {
      assignedToId: "user-nina",
      dueDate: "2026-05-15",
      visibility: "confidential",
      urgency: "high",
      titleIncludes: "RIF list",
      titleExcludes: ["confidential", "urgently", "nina"],
    },
  },
  {
    name: "flags first-name collision as ambiguous",
    message: "assign Aaron to update the company financial reports the first Monday of every month",
    expected: {
      recurrence: "monthly",
      missing: ["assignee"],
      dueDate: "2026-06-01",
    },
  },
  {
    name: "allows full-name disambiguation",
    message: "assign Aaron Blake to update the company financial reports by EOW",
    expected: {
      assignedToId: "user-aaron-b",
      dueDate: "2026-05-15",
      title: "Update the company financial reports",
    },
  },
  {
    name: "asks on contested first-name assignment",
    message: "assign Aaron to review the vendor contract by EOW",
    expected: {
      assignedToId: "user-aaron",
      missing: ["assignee"],
      dueDate: "2026-05-15",
      titleIncludes: "vendor contract",
    },
  },
  {
    name: "keeps profile routing while asking for compact time",
    message: "ask the assistant to schedule the board prep call tomorrow at 230",
    expected: {
      assignedToId: "user-jordan",
      positionProfileId: "profile-ea",
      dueDate: "2026-05-15",
      missing: ["timeMeridiem"],
      titleIncludes: "board prep call",
    },
  },
  {
    name: "parses estimates without inflating time",
    message: "Assign Jordan urgent review of the vendor contract by next Friday, 1.5 hours",
    expected: {
      assignedToId: "user-jordan",
      estimatedMinutes: 90,
      urgency: "high",
      titleIncludes: "vendor contract",
    },
  },
  {
    name: "excludes personal tasks from role routing",
    message: "personal reminder to schedule my dentist appointment tomorrow",
    expected: {
      assignedToId: "user-aaron",
      visibility: "personal",
      positionProfileId: null,
    },
  },
  {
    name: "routes sales profile shorthand",
    message: "assign sales to follow up on the ACME renewal by EOW",
    expected: {
      assignedToId: "user-maya",
      positionProfileId: "profile-sales",
      dueDate: "2026-05-15",
      titleIncludes: "ACME renewal",
    },
  },
  {
    name: "routes task-first assignment to closest role title",
    message: "assign a customer report to the client success by EOW",
    profilesOverride: profilesWithClientSuccess,
    expected: {
      assignedToId: "user-maya",
      positionProfileId: "profile-client-success",
      dueDate: "2026-05-15",
      titleIncludes: "customer report",
      titleExcludes: ["client success"],
    },
  },
  {
    name: "asks when task-first role title is contested",
    message: "assign a customer report to the client success by EOW",
    profilesOverride: profilesWithContestedClientSuccess,
    expected: {
      assignedToId: "user-aaron",
      dueDate: "2026-05-15",
      missing: ["assignee", "positionProfile"],
      titleIncludes: "customer report",
    },
  },
  {
    name: "routes exact generated profile tag",
    message: "assign payroll reports to the finance intern by EOW",
    profilesOverride: profilesWithFinanceIntern,
    expected: {
      assignedToId: "user-nina",
      positionProfileId: "profile-finance-intern",
      dueDate: "2026-05-15",
      titleIncludes: "payroll reports",
      titleExcludes: ["finance intern"],
    },
  },
  {
    name: "asks when generated single-word profile tag is contested",
    message: "assign payroll reports to the intern by EOW",
    profilesOverride: profilesWithMultipleInterns,
    expected: {
      assignedToId: "user-aaron",
      dueDate: "2026-05-15",
      missing: ["assignee", "positionProfile"],
      titleIncludes: "payroll reports",
    },
  },
  {
    name: "asks when finance tag has multiple profile matches",
    message: "assign earnings reports to finance by EOW",
    profilesOverride: profilesWithTwoFinanceProfiles,
    expected: {
      assignedToId: "user-aaron",
      dueDate: "2026-05-15",
      missing: ["assignee", "positionProfile"],
      titleIncludes: "earnings reports",
    },
  },
  {
    name: "does not route tags for vacant profiles",
    message: "assign payroll reports to the finance intern by EOW",
    profilesOverride: profilesWithVacantFinanceIntern,
    expected: {
      assignedToId: "user-aaron",
      dueDate: "2026-05-15",
      missing: ["assignee"],
      positionProfileId: null,
      titleIncludes: "payroll reports",
    },
  },
  {
    name: "routes tags to delegated covered profile holder",
    message: "assign payroll reports to the finance intern by EOW",
    profilesOverride: profilesWithCoveredFinanceIntern,
    expected: {
      assignedToId: "user-nina",
      positionProfileId: "profile-finance-intern",
      dueDate: "2026-05-15",
      titleIncludes: "payroll reports",
    },
  },
];

describe("Donnit task intelligence evals", () => {
  it.each(evalCases)("$name", ({ message, expected, profilesOverride, aliasesOverride }) => {
    vi.setSystemTime(new Date("2026-05-14T10:00:00-04:00"));

    const actual = __chatParserTest.evaluateDeterministicChatTask({
      message,
      members,
      profiles: profilesOverride ?? profiles,
      aliases: aliasesOverride ?? [],
      requesterId: "user-aaron",
    });

    for (const [key, value] of Object.entries(expected)) {
      if (key === "titleIncludes" || key === "titleExcludes") continue;
      expect(actual[key as keyof typeof actual], `${message}: ${key}`).toEqual(value);
    }
    if (expected.titleIncludes) {
      expect(actual.title.toLowerCase(), message).toContain(expected.titleIncludes.toLowerCase());
    }
    for (const excluded of expected.titleExcludes ?? []) {
      expect(actual.title.toLowerCase(), message).not.toContain(excluded.toLowerCase());
    }
  });
});

describe("Position Profile memory helpers", () => {
  it("captures role continuity context from task facts, notes, subtasks, and events", () => {
    const task = {
      id: "task-1",
      org_id: "org-1",
      title: "Update company financial reports",
      description: "Repeat details: first Monday of every month. Pull bank data and review variance notes.",
      status: "completed",
      urgency: "high",
      due_date: "2026-06-01",
      due_time: "09:00",
      start_time: null,
      end_time: null,
      is_all_day: false,
      estimated_minutes: 90,
      assigned_to: "user-nina",
      assigned_by: "user-aaron",
      delegated_to: null,
      collaborator_ids: [],
      source: "chat",
      recurrence: "monthly",
      reminder_days_before: 5,
      position_profile_id: "profile-finance",
      visibility: "work",
      visible_from: null,
      accepted_at: null,
      denied_at: null,
      completed_at: "2026-05-14T15:00:00.000Z",
      completion_notes: "Use the variance tab before sending to leadership.",
      created_at: "2026-05-14T10:00:00.000Z",
    } as never;
    const subtasks = [
      {
        id: "subtask-1",
        task_id: "task-1",
        org_id: "org-1",
        title: "Pull bank data",
        status: "open",
        position: 0,
        completed_at: null,
        created_at: "2026-05-14T10:01:00.000Z",
      },
    ] as never;
    const events = [
      {
        id: "event-1",
        org_id: "org-1",
        task_id: "task-1",
        actor_id: "user-nina",
        type: "completed",
        note: "Sent after checking the variance tab.",
        created_at: "2026-05-14T15:00:00.000Z",
      },
    ] as never;

    const summary = __chatParserTest.taskContinuitySummary({
      task,
      eventType: "completed",
      note: "Sent after checking the variance tab.",
      subtasks,
      events,
    });
    const markdown = __chatParserTest.taskMemoryMarkdown({
      task,
      eventType: "completed",
      note: "Sent after checking the variance tab.",
      subtasks,
      events,
      summary,
    });

    expect(summary).toContain("recurring monthly");
    expect(summary).toContain("appear 5 day(s) before");
    expect(summary).toContain("Open subtasks: Pull bank data");
    expect(summary).toContain("Recent activity: completed");
    expect(markdown).toContain("## Continuity summary");
    expect(markdown).toContain("- [ ] Pull bank data");
    expect(__chatParserTest.taskMemoryTitleKey("Update company financial reports")).toBe("update-company-financial-reports");
  });
});
