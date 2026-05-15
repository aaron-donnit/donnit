import { describe, expect, it, vi } from "vitest";

import { __chatParserTest } from "./routes";

// Goal of this file: pin the deterministic parser's behavior on inputs that
// look the way each ingest channel actually delivers content. The existing
// chat-parser.test.ts and task-intelligence-evals.test.ts cover chat prose.
// This file proves the same parser interprets:
//
//   - Gmail inbound message bodies
//   - Slack message events (with @-mention normalization)
//   - Twilio SMS bodies (terse, abbreviated)
//
// Every case here goes through the same `evaluateDeterministicChatTask`
// pipeline that backs /api/integrations/slack/events,
// /api/integrations/sms/inbound, and the Gmail suggestion approval flow.
//
// Cases that the parser does NOT yet handle reliably are kept as `it.todo`
// so they appear in test output as pending. Promoting a TODO to `it` is the
// signal that the parser has caught up.

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
] as never;

function evaluate(message: string) {
  return __chatParserTest.evaluateDeterministicChatTask({
    message,
    members,
    profiles,
    aliases: [],
    requesterId: "user-aaron",
  });
}

describe("Gmail inbound parsing", () => {
  it("extracts an assigned task from a plain request email body", () => {
    vi.setSystemTime(new Date("2026-05-14T10:00:00-04:00"));
    const body = "Hi Aaron, please ask Nina to draft the renewal proposal by Friday. Thanks, Taylor";
    const result = evaluate(body);
    expect(result.assignedToId).toBe("user-nina");
    expect(result.title.toLowerCase()).toContain("renewal proposal");
    expect(result.dueDate).toBe("2026-05-15");
  });

  it("preserves urgency cues that arrive in email bodies", () => {
    vi.setSystemTime(new Date("2026-05-14T10:00:00-04:00"));
    const body = "please get Nina to urgently take care of the RIF list by Friday — this is confidential";
    const result = evaluate(body);
    expect(result.assignedToId).toBe("user-nina");
    expect(result.urgency).toBe("high");
    expect(result.visibility).toBe("confidential");
    expect(result.dueDate).toBe("2026-05-15");
  });

  it.todo("infers assignment from `can the [role] …?` phrasing common in emails");
  it.todo("routes role-addressed email (`ask the EA to …`) to the profile owner when the role title contains `to`");

  it("repairs common email typos before extracting work", () => {
    vi.setSystemTime(new Date("2026-05-14T10:00:00-04:00"));
    const body = "assign Nina to drafft the clent proposal by tomorow";
    const result = evaluate(body);
    expect(result.assignedToId).toBe("user-nina");
    expect(result.title).toBe("Draft the client proposal");
    expect(result.dueDate).toBe("2026-05-15");
  });

  it.todo("strips quoted reply tails (`> on Mon …`) before parsing");
  it.todo("ignores email signature blocks when extracting title");
  it.todo("treats forwarded fwd: prefixes as non-actionable context");
});

describe("Slack inbound parsing", () => {
  it("interprets a resolved mention paired with an explicit assignment verb", () => {
    vi.setSystemTime(new Date("2026-05-14T10:00:00-04:00"));
    const message = "assign @Nina Patel to handle the vendor renewal by EOW";
    const result = evaluate(message);
    expect(result.assignedToId).toBe("user-nina");
    expect(result.dueDate).toBe("2026-05-15");
    expect(result.title.toLowerCase()).toContain("vendor renewal");
  });

  it.todo("infers assignment from `have @Name …` without `to` connector");

  it("routes a role mention to the profile owner without an at-sign", () => {
    vi.setSystemTime(new Date("2026-05-14T10:00:00-04:00"));
    const message = "assign sales to follow up on the ACME renewal by EOW";
    const result = evaluate(message);
    expect(result.assignedToId).toBe("user-maya");
    expect(result.positionProfileId).toBe("profile-sales");
    expect(result.dueDate).toBe("2026-05-15");
  });

  it("flags a contested first-name as ambiguous instead of guessing", () => {
    vi.setSystemTime(new Date("2026-05-14T10:00:00-04:00"));
    const message = "assign Aaron to take the renewal by Friday";
    const result = evaluate(message);
    expect(result.missing).toContain("assignee");
  });

  it.todo("normalizes raw Slack mention tokens `<@U0123ABC>` to a workspace user");
  it.todo("ignores Slack code blocks ``` … ``` when extracting title text");
  it.todo("infers assignment from `@Name can you …` without explicit assignment verb");
});

describe("Twilio SMS inbound parsing", () => {
  it("parses a terse SMS with an explicit assignment verb", () => {
    vi.setSystemTime(new Date("2026-05-14T10:00:00-04:00"));
    const body = "assign Nina to submit payroll by Friday";
    const result = evaluate(body);
    expect(result.assignedToId).toBe("user-nina");
    expect(result.dueDate).toBe("2026-05-15");
    expect(result.title.toLowerCase()).toContain("payroll");
  });

  it.todo("infers assignment from `Name please …` without explicit verb in SMS context");
  it.todo("treats short SMS-style `Nina handle payroll Fri` as an assignment");

  it("disambiguates with a full name when first names collide", () => {
    vi.setSystemTime(new Date("2026-05-14T10:00:00-04:00"));
    const body = "Assign Aaron Blake the financial reports by EOW";
    const result = evaluate(body);
    expect(result.assignedToId).toBe("user-aaron-b");
    expect(result.dueDate).toBe("2026-05-15");
    expect(result.title.toLowerCase()).toContain("financial reports");
  });

  it("asks for AM/PM clarification on compact times common in SMS", () => {
    vi.setSystemTime(new Date("2026-05-14T10:00:00-04:00"));
    const body = "call Maya at 230 tomorrow about the renewal packet";
    const result = evaluate(body);
    expect(result.missing).toContain("timeMeridiem");
  });

  it.todo("treats common SMS abbreviations (mtg, asap, tmrw) as task language");
  it.todo("preserves urgency cues when SMS body is shouting (ALL CAPS)");
});
