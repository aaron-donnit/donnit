import { describe, expect, it } from "vitest";

import { buildPositionProfiles } from "../client/src/app/lib/profiles";
import type { PersistedPositionProfile, Task, TaskEvent, User } from "../client/src/app/types";

// Pins the role-handover behavior that is MVP-blocking: when a position
// profile is reassigned, the new owner must inherit all the role's
// continuity context that the old owner had — current work, recurring
// responsibilities, completed history, and a transition checklist.
//
// This is the strongest possible "memory transfer" smoke test we can run
// without spinning up Supabase: build the same profile view before and
// after reassignment, then assert the new owner sees what the old owner
// saw and the old owner no longer does.

const usersWithOriginalOwner: User[] = [
  {
    id: "user-admin",
    name: "Aaron Hassett",
    email: "aaron@example.com",
    role: "admin",
    persona: "operator",
    managerId: null,
    canAssign: true,
    status: "active",
  },
  {
    id: "user-jordan",
    name: "Jordan Lee",
    email: "jordan@example.com",
    role: "member",
    persona: "operations",
    managerId: "user-admin",
    canAssign: false,
    status: "active",
  },
  {
    id: "user-nina",
    name: "Nina Patel",
    email: "nina@example.com",
    role: "member",
    persona: "operations",
    managerId: "user-admin",
    canAssign: false,
    status: "active",
  },
];

function task(overrides: Partial<Task> & Pick<Task, "id" | "title">): Task {
  return {
    id: overrides.id,
    title: overrides.title,
    description: overrides.description ?? "",
    status: overrides.status ?? "open",
    urgency: overrides.urgency ?? "normal",
    dueDate: overrides.dueDate ?? null,
    dueTime: overrides.dueTime ?? null,
    startTime: overrides.startTime ?? null,
    endTime: overrides.endTime ?? null,
    isAllDay: overrides.isAllDay ?? false,
    estimatedMinutes: overrides.estimatedMinutes ?? 30,
    assignedToId: overrides.assignedToId ?? "user-jordan",
    assignedById: overrides.assignedById ?? "user-admin",
    delegatedToId: overrides.delegatedToId ?? null,
    collaboratorIds: overrides.collaboratorIds ?? [],
    source: overrides.source ?? "chat",
    recurrence: overrides.recurrence ?? "none",
    reminderDaysBefore: overrides.reminderDaysBefore ?? 0,
    positionProfileId: overrides.positionProfileId ?? null,
    visibility: overrides.visibility ?? "work",
    visibleFrom: overrides.visibleFrom ?? null,
    acceptedAt: overrides.acceptedAt ?? null,
    deniedAt: overrides.deniedAt ?? null,
    completedAt: overrides.completedAt ?? null,
    completionNotes: overrides.completionNotes ?? "",
    createdAt: overrides.createdAt ?? "2026-05-12T14:00:00.000Z",
  };
}

function profileRecord(overrides: Partial<PersistedPositionProfile> = {}): PersistedPositionProfile {
  return {
    id: "profile-ea",
    title: "Executive Assistant to the CEO",
    status: "active",
    currentOwnerId: "user-jordan",
    directManagerId: "user-admin",
    temporaryOwnerId: null,
    delegateUserId: null,
    delegateUntil: null,
    autoUpdateRules: {},
    institutionalMemory: {},
    riskScore: 0,
    riskSummary: "",
    createdAt: "2026-05-01T12:00:00.000Z",
    updatedAt: "2026-05-12T12:00:00.000Z",
    ...overrides,
  };
}

const linkedTasks: Task[] = [
  task({
    id: "task-recurring",
    title: "Submit weekly leadership briefing",
    recurrence: "weekly",
    dueDate: "2026-05-22",
    positionProfileId: "profile-ea",
    assignedToId: "user-jordan",
    description: "Pull metrics from the dashboard and email leadership by 4pm Fridays.",
  }),
  task({
    id: "task-current",
    title: "Draft board packet",
    dueDate: "2026-05-20",
    positionProfileId: "profile-ea",
    assignedToId: "user-jordan",
    urgency: "high",
  }),
  task({
    id: "task-completed",
    title: "Renew office lease",
    status: "completed",
    completedAt: "2026-05-05T15:00:00.000Z",
    completionNotes: "Lease signed and stored in the finance folder.",
    positionProfileId: "profile-ea",
    assignedToId: "user-jordan",
  }),
];

const linkedEvents: TaskEvent[] = [
  {
    id: "evt-1",
    taskId: "task-completed",
    actorId: "user-jordan",
    type: "completed",
    note: "Signed",
    createdAt: "2026-05-05T15:00:00.000Z",
  },
];

describe("Position Profile handover", () => {
  it("the original owner sees the linked tasks before reassignment", () => {
    const profiles = buildPositionProfiles(linkedTasks, usersWithOriginalOwner, linkedEvents, [profileRecord()]);
    const profile = profiles.find((item) => item.id === "profile-ea");
    expect(profile, "profile-ea must exist").toBeTruthy();
    expect(profile?.currentOwnerId).toBe("user-jordan");
    expect(profile?.currentIncompleteTasks.map((item) => item.id).sort()).toEqual(["task-current", "task-recurring"]);
    expect(profile?.recurringTasks.map((item) => item.id)).toEqual(["task-recurring"]);
    expect(profile?.completedTasks.map((item) => item.id)).toEqual(["task-completed"]);
    expect(profile?.transitionChecklist.length).toBeGreaterThan(0);
  });

  it("after reassignment, the new owner inherits the same role context", () => {
    const reassignedTasks = linkedTasks.map((item) => ({ ...item, assignedToId: "user-nina" }));
    const reassignedRecord = profileRecord({ currentOwnerId: "user-nina", updatedAt: "2026-05-15T12:00:00.000Z" });

    const profiles = buildPositionProfiles(reassignedTasks, usersWithOriginalOwner, linkedEvents, [reassignedRecord]);
    const profile = profiles.find((item) => item.id === "profile-ea");

    expect(profile?.currentOwnerId).toBe("user-nina");
    expect(profile?.currentIncompleteTasks.map((item) => item.id).sort()).toEqual(["task-current", "task-recurring"]);
    expect(profile?.recurringTasks.map((item) => item.id)).toEqual(["task-recurring"]);
    expect(profile?.completedTasks.map((item) => item.id)).toEqual(["task-completed"]);
    expect(profile?.transitionChecklist.length).toBeGreaterThan(0);
  });

  it("after reassignment, the previous owner no longer sees the role's tasks under the role profile", () => {
    const reassignedTasks = linkedTasks.map((item) => ({ ...item, assignedToId: "user-nina" }));
    const reassignedRecord = profileRecord({ currentOwnerId: "user-nina" });

    const profiles = buildPositionProfiles(reassignedTasks, usersWithOriginalOwner, linkedEvents, [reassignedRecord]);
    const ea = profiles.find((item) => item.id === "profile-ea");
    const jordanPersonal = profiles.find((item) => item.id === "position-user-jordan");

    // The role profile is owned by Nina now.
    expect(ea?.currentOwnerId).toBe("user-nina");
    // Jordan's derived (person-level) profile should not list the EA role's tasks
    // because they were reassigned away.
    expect(jordanPersonal?.currentIncompleteTasks.map((item) => item.id) ?? []).not.toContain("task-current");
    expect(jordanPersonal?.currentIncompleteTasks.map((item) => item.id) ?? []).not.toContain("task-recurring");
  });

  it("temporary coverage routes tasks to the delegate without disrupting the persisted owner", () => {
    const covered = profileRecord({
      status: "covered",
      currentOwnerId: "user-jordan",
      delegateUserId: "user-nina",
      delegateUntil: "2026-06-01",
    });
    const profiles = buildPositionProfiles(linkedTasks, usersWithOriginalOwner, linkedEvents, [covered]);
    const profile = profiles.find((item) => item.id === "profile-ea");

    expect(profile?.status).toBe("covered");
    expect(profile?.currentOwnerId).toBe("user-jordan");
    expect(profile?.delegateUserId).toBe("user-nina");
    // Linked tasks remain visible on the role profile during coverage.
    expect(profile?.currentIncompleteTasks.map((item) => item.id).sort()).toEqual(["task-current", "task-recurring"]);
  });

  it("a vacant profile keeps linked tasks visible so a successor can pick them up", () => {
    const vacant = profileRecord({ status: "vacant", currentOwnerId: null });
    const profiles = buildPositionProfiles(linkedTasks, usersWithOriginalOwner, linkedEvents, [vacant]);
    const profile = profiles.find((item) => item.id === "profile-ea");

    expect(profile?.status).toBe("vacant");
    expect(profile?.currentOwnerId).toBeNull();
    expect(profile?.currentIncompleteTasks.map((item) => item.id).sort()).toEqual(["task-current", "task-recurring"]);
    expect(profile?.recurringTasks.map((item) => item.id)).toEqual(["task-recurring"]);
  });
});

describe("Confidential visibility during handover", () => {
  it("confidential tasks are excluded from the role profile's continuity context", () => {
    const tasksWithConfidential: Task[] = [
      ...linkedTasks,
      task({
        id: "task-confidential",
        title: "RIF list review",
        positionProfileId: "profile-ea",
        assignedToId: "user-jordan",
        visibility: "confidential",
        dueDate: "2026-05-22",
      }),
    ];
    const profiles = buildPositionProfiles(tasksWithConfidential, usersWithOriginalOwner, linkedEvents, [profileRecord()]);
    const profile = profiles.find((item) => item.id === "profile-ea");
    // Confidential work must not leak into the role-profile view that anyone
    // with role visibility could read after reassignment. The current
    // implementation filters by visibility !== "personal"; this test pins
    // expected MVP-grade behavior. If the assertion fails, confidential
    // visibility is leaking — DO NOT loosen the test, fix the leak.
    const ids = profile?.currentIncompleteTasks.map((item) => item.id) ?? [];
    expect(ids).not.toContain("task-confidential");
  });

  it("personal tasks linked to a profile id are never surfaced on the role profile", () => {
    const tasksWithPersonal: Task[] = [
      ...linkedTasks,
      task({
        id: "task-personal",
        title: "Pick up prescription",
        positionProfileId: "profile-ea",
        assignedToId: "user-jordan",
        visibility: "personal",
      }),
    ];
    const profiles = buildPositionProfiles(tasksWithPersonal, usersWithOriginalOwner, linkedEvents, [profileRecord()]);
    const profile = profiles.find((item) => item.id === "profile-ea");
    const ids = profile?.currentIncompleteTasks.map((item) => item.id) ?? [];
    expect(ids).not.toContain("task-personal");
  });
});
