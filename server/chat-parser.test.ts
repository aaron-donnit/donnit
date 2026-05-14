import { afterEach, describe, expect, it, vi } from "vitest";

import { __chatParserTest } from "./routes";

describe("chat task parser", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("understands monthly ordinal recurrence and cleans assignment boilerplate", () => {
    vi.setSystemTime(new Date("2026-05-12T16:00:00-04:00"));
    const prompt = "assign aaron has a reoccuring task to update the company financial reports the first monday of every month";

    expect(__chatParserTest.parseTaskRecurrence(prompt)).toBe("monthly");
    expect(__chatParserTest.parseDueDate(prompt)).toBe("2026-06-01");
    expect(__chatParserTest.titleFromMessage(prompt, ["Aaron Hassett", "aaron@rosterstack.com"])).toBe(
      "Update the company financial reports",
    );
  });

  it("treats first-name-only teammate mentions as ambiguous when names collide", () => {
    const users = [
      { name: "Aaron Hassett", email: "aaron@rosterstack.com" },
      { name: "Aaron Blake", email: "aaron.blake@example.com" },
      { name: "Nina Patel", email: "nina@example.com" },
    ];

    const ambiguous = __chatParserTest.findBestMentionedCandidates(
      "assign aaron to update the company financial reports",
      users,
      (user) => user.name,
      (user) => user.email,
    );
    expect(ambiguous.map((user) => user.name)).toEqual(["Aaron Hassett", "Aaron Blake"]);

    const specific = __chatParserTest.findBestMentionedCandidates(
      "assign Aaron Hassett to update the company financial reports",
      users,
      (user) => user.name,
      (user) => user.email,
    );
    expect(specific.map((user) => user.name)).toEqual(["Aaron Hassett"]);
  });

  it("rolls monthly ordinal recurring tasks to the next matching weekday", () => {
    const nextDue = __chatParserTest.nextRecurringDueDate({
      due_date: "2026-06-01",
      recurrence: "monthly",
      description: "Repeat details: First Monday of every month",
    } as never);

    expect(nextDue).toBe("2026-07-06");
  });

  it("does not treat one-time weekday due dates as recurring", () => {
    expect(__chatParserTest.parseTaskRecurrence("send the board packet by Monday")).toBe("none");
    expect(__chatParserTest.parseTaskRecurrence("send the board packet every Monday")).toBe("weekly");
    expect(__chatParserTest.parseTaskRecurrence("send the board packet Mondays")).toBe("weekly");
  });

  it("rewrites requester pronouns when assigning work to someone else", () => {
    vi.setSystemTime(new Date("2026-05-12T16:00:00-04:00"));
    const prompt = "assign Nina to send me a payroll report by EOW";
    const title = __chatParserTest.titleFromMessage(prompt, ["Nina Patel", "nina@example.com"]);

    expect(title).toBe("Send me a payroll report");
    expect(__chatParserTest.rewriteRequesterReferencesInTitle(title, "Aaron", true)).toBe(
      "Send Aaron a payroll report",
    );
    expect(__chatParserTest.parseDueDate(prompt)).toBe("2026-05-15");
  });

  it("keeps contact names out of assignment routing for self-owned outreach", () => {
    expect(__chatParserTest.hasExplicitAssignmentIntent("call Maya tomorrow at noon")).toBe(false);
    expect(__chatParserTest.titleFromMessage("call Maya tomorrow at noon")).toBe("Call Maya");
    expect(__chatParserTest.parseTaskTime("call Maya tomorrow at noon", 30)).toMatchObject({
      dueTime: "12:00",
      startTime: "12:00",
      endTime: "12:30",
      isAllDay: false,
    });
  });

  it("detects compact clock times that need AM or PM clarification", () => {
    expect(__chatParserTest.ambiguousCompactClockTime("call Maya at 230")).toMatchObject({
      display: "2:30",
    });
    expect(__chatParserTest.ambiguousCompactClockTime("call Maya at 2:30pm")).toBeNull();
    expect(__chatParserTest.ambiguousCompactClockTime("call Maya at 14:30")).toBeNull();
  });

  it("does not ask for availability when an email already proposed a meeting time", () => {
    const draft = __chatParserTest.fallbackReplyDraft({
      from_email: "Taylor <taylor@example.com>",
      subject: "Board meeting tomorrow",
      suggested_title: "Schedule board meeting",
      preview: "Taylor asked to schedule the board meeting tomorrow at noon.",
      body: "Can you schedule the board meeting for tomorrow at noon?",
    });

    expect(draft).toContain("tomorrow at noon");
    expect(draft.toLowerCase()).not.toContain("please send a few times");
    expect(draft.toLowerCase()).not.toContain("availability");
  });

  it("uses specific repeat details in chat task confirmations", () => {
    const outcome = __chatParserTest.chatTaskOutcome(
      {
        title: "Update the company financial reports",
        assigned_to: "user-nina",
        due_date: "2026-06-01",
        due_time: null,
        start_time: null,
        recurrence: "monthly",
        description: "Repeat details: First Monday of every month",
        urgency: "normal",
        visibility: "work",
      } as never,
      [{ user_id: "user-nina", profile: { full_name: "Nina Patel", email: "nina@example.com" } }] as never,
    );

    expect(outcome).toBe(
      "I assigned Nina Patel to update the company financial reports by June 1, 2026. It repeats First Monday of every month.",
    );
  });

  it("defaults to the assignee primary profile unless the text names a profile", () => {
    const profiles = [
      {
        id: "profile-exec",
        title: "Executive Assistant to the CEO",
        current_owner_id: "user-nina",
        temporary_owner_id: null,
        delegate_user_id: null,
      },
      {
        id: "profile-office",
        title: "Office Manager",
        current_owner_id: "user-nina",
        temporary_owner_id: null,
        delegate_user_id: null,
      },
    ];

    expect(
      __chatParserTest.resolveChatPositionProfile({
        profiles: profiles as never,
        assignedToId: "user-nina",
        message: "Assign Nina to renew the vendor contract by Friday",
        visibility: "work",
      }),
    ).toMatchObject({ positionProfileId: "profile-exec", needsChoice: false });

    expect(
      __chatParserTest.resolveChatPositionProfile({
        profiles: profiles as never,
        assignedToId: "user-nina",
        message: "Assign Nina under Office Manager to renew the vendor contract by Friday",
        visibility: "work",
      }),
    ).toMatchObject({ positionProfileId: "profile-office", needsChoice: false });
  });

  it("recognizes an explicitly named profile even before owner routing has resolved", () => {
    const profiles = [
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
        current_owner_id: "user-aaron",
        temporary_owner_id: null,
        delegate_user_id: null,
      },
    ];

    expect(
      __chatParserTest.resolveChatPositionProfile({
        profiles: profiles as never,
        assignedToId: "user-aaron",
        message: "Assign Payroll Coordinator to submit payroll every Friday",
        visibility: "work",
      }),
    ).toMatchObject({ positionProfileId: "profile-payroll", needsChoice: false });
  });

  it("treats assistant as an Executive Assistant profile alias and cleans role wording from the title", () => {
    const profiles = [
      {
        id: "profile-ea",
        title: "Executive Assistant to the CEO",
        current_owner_id: "user-jordan",
        temporary_owner_id: null,
        delegate_user_id: null,
      },
    ];

    expect(
      __chatParserTest.resolveChatPositionProfile({
        profiles: profiles as never,
        assignedToId: "user-aaron",
        message: "assign the assistant with preparing the board packet by eod friday",
        visibility: "work",
      }),
    ).toMatchObject({ positionProfileId: "profile-ea", needsChoice: false });

    expect(
      __chatParserTest.titleFromMessage(
        "assign the assistant with preparing the board packet by eod friday",
        [],
        ["Executive Assistant to the CEO", "assistant"],
      ),
    ).toBe("Preparing the board packet");
  });
});
