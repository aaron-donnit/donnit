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

type EvalExpected = Partial<ReturnType<typeof __chatParserTest.evaluateDeterministicChatTask>> & {
  titleIncludes?: string;
  titleExcludes?: string[];
};

const evalCases: Array<{
  name: string;
  message: string;
  expected: EvalExpected;
  profilesOverride?: typeof profiles;
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
];

describe("Donnit task intelligence evals", () => {
  it.each(evalCases)("$name", ({ message, expected, profilesOverride }) => {
    vi.setSystemTime(new Date("2026-05-14T10:00:00-04:00"));

    const actual = __chatParserTest.evaluateDeterministicChatTask({
      message,
      members,
      profiles: profilesOverride ?? profiles,
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
