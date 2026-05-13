import { describe, expect, it } from "vitest";

import { buildPositionProfiles, profileAssignmentLabel } from "../client/src/app/lib/profiles";
import type { PersistedPositionProfile, Task, User } from "../client/src/app/types";

const users: User[] = [
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
    assignedToId: overrides.assignedToId ?? "user-nina",
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
    id: "profile-ops",
    title: "Operations Coordinator",
    status: "vacant",
    currentOwnerId: null,
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

describe("position profile continuity builder", () => {
  it("keeps linked work visible on vacant saved profiles", () => {
    const profiles = buildPositionProfiles(
      [
        task({
          id: "task-recurring",
          title: "Update monthly close checklist",
          recurrence: "monthly",
          dueDate: "2026-06-01",
          positionProfileId: "profile-ops",
          description: "Repeat details: First Monday of every month",
        }),
        task({
          id: "task-completed",
          title: "Reconcile vendor receipt",
          status: "completed",
          completedAt: "2026-05-10T15:00:00.000Z",
          completionNotes: "Matched receipt to the finance folder.",
          positionProfileId: "profile-ops",
        }),
        task({
          id: "task-personal",
          title: "Personal appointment",
          visibility: "personal",
          positionProfileId: "profile-ops",
        }),
      ],
      users,
      [],
      [profileRecord()],
    );

    const profile = profiles.find((item) => item.id === "profile-ops");
    expect(profile).toBeTruthy();
    expect(profileAssignmentLabel(profile!, users)).toBe("Vacant");
    expect(profile?.currentIncompleteTasks.map((item) => item.id)).toEqual(["task-recurring"]);
    expect(profile?.recurringTasks.map((item) => item.id)).toEqual(["task-recurring"]);
    expect(profile?.completedTasks.map((item) => item.id)).toEqual(["task-completed"]);
  });

  it("does not label one-time linked tasks as recurring from wording alone", () => {
    const profiles = buildPositionProfiles(
      [
        task({
          id: "task-monday",
          title: "Review the board packet by Monday",
          dueDate: "2026-05-18",
          recurrence: "none",
          positionProfileId: "profile-ops",
        }),
      ],
      users,
      [],
      [profileRecord()],
    );

    const profile = profiles.find((item) => item.id === "profile-ops");
    expect(profile?.currentIncompleteTasks.map((item) => item.id)).toEqual(["task-monday"]);
    expect(profile?.recurringTasks).toEqual([]);
  });
});
