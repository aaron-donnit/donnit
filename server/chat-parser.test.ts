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
});
