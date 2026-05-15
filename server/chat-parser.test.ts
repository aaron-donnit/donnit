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

  it("cleans @ mention selections from task titles", () => {
    const prompt = "assign @Nina Patel to review the renewal by Friday";

    expect(__chatParserTest.titleFromMessage(prompt, ["Nina Patel", "nina@example.com"])).toBe("Review the renewal");
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

  it("recognizes casual assignment phrasing and repairs obvious title typos", () => {
    const prompt = "have nina go through and compet all of our wok from the meeting";
    expect(__chatParserTest.hasExplicitAssignmentIntent(prompt)).toBe(true);
    expect(__chatParserTest.titleFromMessage(prompt, ["Nina Patel", "nina", "nina@example.com"])).toBe(
      "Complete all of our work from the meeting",
    );
    expect(__chatParserTest.titleFromMessage(prompt)).toBe("Complete all of our work from the meeting");
  });

  it("normalizes project typos but treats next month as an underspecified deadline", () => {
    const prompt = "assign nina the manhattan projekt for next month";

    expect(__chatParserTest.titleFromMessage(prompt, ["Nina Patel", "nina", "nina@example.com"])).toBe(
      "Manhattan project",
    );
    expect(__chatParserTest.underspecifiedRelativeDatePhrase(prompt)).toMatchObject({
      phrase: "next month",
      question: "What exact due date in next month should I use?",
    });
  });

  it("repairs one-edit date typos before deciding whether to ask", () => {
    const prompt = "assign this to Jordan nect month";

    expect(__chatParserTest.titleFromMessage(prompt, ["Jordan Lee", "Jordan", "jordan@example.com"])).toBe("");
    expect(__chatParserTest.underspecifiedRelativeDatePhrase(prompt)).toMatchObject({
      phrase: "next month",
      question: "What exact due date in next month should I use?",
    });
  });

  it("treats a follow-up due in a month as a precise clarification", () => {
    vi.setSystemTime(new Date("2026-05-15T10:00:00-04:00"));

    expect(__chatParserTest.parseDueDate("it is due in a month, verified")).toBe("2026-06-15");
    expect(__chatParserTest.parseDueDate("due in 2 weeks")).toBe("2026-05-29");
  });

  it("recovers pending task context from the recent chat window", () => {
    vi.setSystemTime(new Date("2026-05-15T10:00:00-04:00"));
    const recovered = __chatParserTest.recoverPendingChatTaskFromRecentMessages({
      messages: [
        {
          id: "m1",
          org_id: "org",
          user_id: "user-aaron",
          role: "user",
          content: "assign nina the project",
          task_id: null,
          created_at: "2026-05-15T14:00:00.000Z",
        },
        {
          id: "m2",
          org_id: "org",
          user_id: "user-aaron",
          role: "assistant",
          content: "Nina Patel can own Project. When is this due?",
          task_id: null,
          created_at: "2026-05-15T14:00:01.000Z",
        },
        {
          id: "m3",
          org_id: "org",
          user_id: "user-aaron",
          role: "user",
          content: "it is due in a month, verified",
          task_id: null,
          created_at: "2026-05-15T14:00:10.000Z",
        },
      ],
      members: [
        { user_id: "user-aaron", profile: { full_name: "Aaron Hassett", email: "aaron@example.com" } },
        { user_id: "user-nina", profile: { full_name: "Nina Patel", email: "nina@example.com" } },
      ] as never,
      positionProfiles: [],
      userId: "user-aaron",
    });

    expect(recovered).toMatchObject({
      title: "Project",
      assignedToId: "user-nina",
      missing: ["dueDate"],
    });
  });

  it("repairs close operational typos without changing valid words or names", () => {
    vi.setSystemTime(new Date("2026-05-14T10:00:00-04:00"));
    const prompt = "assign Jordan to revieew the reprot by frday";

    expect(__chatParserTest.normalizeCommonTaskTypos(prompt)).toBe("assign Jordan to review the report by friday");
    expect(__chatParserTest.titleFromMessage(prompt, ["Jordan Lee", "Jordan", "jordan@example.com"])).toBe(
      "Review the report",
    );
    expect(__chatParserTest.parseDueDate(prompt)).toBe("2026-05-15");
    expect(__chatParserTest.normalizeCommonTaskTypos("complete all of our wok")).toBe("complete all of our work");
  });

  it("uses the English dictionary for broader typo coverage", () => {
    vi.setSystemTime(new Date("2026-05-14T10:00:00-04:00"));
    const prompt = "assign Nina to drafft the clent proposal by tomorow";

    expect(__chatParserTest.normalizeCommonTaskTypos(prompt)).toBe(
      "assign Nina to draft the client proposal by tomorrow",
    );
    expect(__chatParserTest.titleFromMessage(prompt, ["Nina Patel", "nina", "nina@example.com"])).toBe(
      "Draft the client proposal",
    );
    expect(__chatParserTest.parseDueDate(prompt)).toBe("2026-05-15");
  });

  it("normalizes basic grammar typos and flags vague deck work", () => {
    const prompt = "assign Nina to work on tha client deck for our processing call by May 21";

    expect(__chatParserTest.normalizeCommonTaskTypos(prompt)).toContain("work on the client deck");
    expect(__chatParserTest.titleFromMessage(prompt, ["Nina Patel", "nina", "nina@example.com"])).toBe(
      "Work on the client deck for our processing call",
    );
    expect(__chatParserTest.needsSpecificActionClarification("Work on the client deck for our processing call", prompt)).toBe(true);
  });

  it("normalizes assistant and proposal typos in role-based assignment", () => {
    const prompt = "have the assistnt draft a poposal for the new lease in manhattan";

    expect(__chatParserTest.normalizeCommonTaskTypos(prompt)).toBe(
      "have the assistant draft a proposal for the new lease in manhattan",
    );
    expect(
      __chatParserTest.titleFromMessage(prompt, ["Jordan Lee", "jordan@example.com", "assistant", "Executive Assistant to the CEO"]),
    ).toBe("Draft a proposal for the new lease in manhattan");
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

  it("matches a position task profile from outcome language", () => {
    const memories = [
      {
        id: "profile-memory-recruiting",
        position_profile_id: "profile-hr",
        source_task_id: null,
        title: "Standard recruiting workflow",
        objective: "Produce a consistent recruiting process from intake through candidate handoff.",
        cadence: "none",
        due_rule: "",
        start_offset_days: 0,
        default_urgency: "high",
        default_estimated_minutes: 45,
        status: "active",
        version: 1,
        confidence_score: 0.9,
        learned_from: {},
        created_by: "user-1",
        org_id: "org-1",
        created_at: "2026-05-15T00:00:00.000Z",
        updated_at: "2026-05-15T00:00:00.000Z",
        last_learned_at: "2026-05-15T00:00:00.000Z",
        steps: [
          { title: "Confirm role intake", position: 0 },
          { title: "Post job description", position: 1 },
        ],
      },
      {
        id: "profile-memory-finance",
        position_profile_id: "profile-finance",
        source_task_id: null,
        title: "Monthly financial report",
        objective: "Prepare payroll, P&L, revenue, and EBITDA reporting for leadership.",
        cadence: "monthly",
        due_rule: "",
        start_offset_days: 5,
        default_urgency: "high",
        default_estimated_minutes: 60,
        status: "active",
        version: 1,
        confidence_score: 0.9,
        learned_from: {},
        created_by: "user-1",
        org_id: "org-1",
        created_at: "2026-05-15T00:00:00.000Z",
        updated_at: "2026-05-15T00:00:00.000Z",
        last_learned_at: "2026-05-15T00:00:00.000Z",
        steps: [{ title: "Pull payroll report", position: 0 }],
      },
    ] as never;

    expect(__chatParserTest.selectTaskProfile(memories, { title: "Build out a standard recruiting workflow" })?.id).toBe(
      "profile-memory-recruiting",
    );
    expect(__chatParserTest.taskProfileScore(memories[0], { title: "Build out a standard recruiting workflow" })).toBeGreaterThan(28);
    expect(__chatParserTest.selectTaskProfile(memories, { title: "Call Nina about candidate feedback" })).toBeNull();
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
    ).toBe("Prepare the board packet");
  });

  it("normalizes and filters learnable alias phrases", () => {
    expect(__chatParserTest.workspaceAliasNormalizedForm("  My EA! ")).toBe("my ea");
    expect(__chatParserTest.shouldLearnAliasPhrase("my EA", "Jordan Lee")).toBe(true);
    expect(__chatParserTest.shouldLearnAliasPhrase("Jordan Lee", "Jordan Lee")).toBe(false);
    expect(__chatParserTest.shouldLearnAliasPhrase("it", "Board Packet")).toBe(false);
  });
});
