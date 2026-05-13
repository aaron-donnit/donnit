import type { PositionProfile, PersistedPositionProfile, Task, User, TaskEvent, Id } from "@/app/types";
import { localDateIso } from "@/app/lib/date";
import { inferTaskCadence, taskKnowledgeText, positionTitleForUser, inferToolsFromTasks } from "@/app/lib/task-text";
import { memoryAccessItems, memoryStringArray, memoryHowToNotes, memoryRecurringResponsibilities } from "@/app/lib/memory";

export function mergeProfileRecord(profile: PositionProfile, record: PersistedPositionProfile): PositionProfile {
  const memory = record.institutionalMemory ?? {};
  const accessItems = memoryAccessItems(memory);
  const learnedHowTo = memoryHowToNotes(memory).map((item) => item.note);
  const learnedRecurring = memoryRecurringResponsibilities(memory).map((item) => item.title);
  const howTo = Array.from(new Set([...memoryStringArray(memory, ["howTo"]), ...learnedHowTo, ...profile.howTo])).slice(0, 6);
  const tools = Array.from(new Set([...memoryStringArray(memory, ["tools", "toolAccess"]), ...accessItems.map((item) => item.toolName), ...profile.tools])).slice(0, 8);
  const stakeholders = Array.from(new Set([...memoryStringArray(memory, ["stakeholders", "contacts"]), ...profile.stakeholders])).slice(0, 8);
  const criticalDates = Array.from(new Set([...memoryStringArray(memory, ["criticalDates"]), ...profile.criticalDates])).slice(0, 6);
  const learnedRecurringChecklist = learnedRecurring.length > 0
    ? [`Review ${learnedRecurring.length} learned recurring ${learnedRecurring.length === 1 ? "responsibility" : "responsibilities"}.`]
    : [];
  const transitionChecklist = Array.from(
    new Set([...memoryStringArray(memory, ["transitionChecklist"]), ...learnedRecurringChecklist, ...profile.transitionChecklist]),
  ).slice(0, 7);
  const riskReasons = Array.from(
    new Set([record.riskSummary, ...profile.riskReasons].filter((item): item is string => Boolean(item))),
  ).slice(0, 5);
  const riskScore = Math.max(record.riskScore ?? 0, profile.riskScore);

  return {
    ...profile,
    id: record.id,
    persisted: true,
    title: record.title || profile.title,
    status: record.status || profile.status,
    currentOwnerId: record.currentOwnerId,
    directManagerId: record.directManagerId,
    temporaryOwnerId: record.temporaryOwnerId,
    delegateUserId: record.delegateUserId,
    delegateUntil: record.delegateUntil,
    howTo,
    tools,
    stakeholders,
    accessItems,
    institutionalMemory: memory,
    criticalDates,
    transitionChecklist,
    riskScore,
    riskLevel: riskScore >= 60 ? "high" : riskScore >= 30 ? "medium" : "low",
    riskReasons,
    lastUpdatedAt: record.updatedAt ?? profile.lastUpdatedAt,
  };
}

export function buildEmptyPositionProfile(record: PersistedPositionProfile, users: User[]): PositionProfile | null {
  const owner =
    users.find((user) => String(user.id) === String(record.currentOwnerId)) ??
    users[0] ??
    null;
  if (!owner) return null;
  const base: PositionProfile = {
    id: record.id,
    persisted: true,
    title: record.title,
    owner,
    currentOwnerId: record.currentOwnerId,
    directManagerId: record.directManagerId,
    temporaryOwnerId: record.temporaryOwnerId,
    delegateUserId: record.delegateUserId,
    delegateUntil: record.delegateUntil,
    status: record.status,
    currentIncompleteTasks: [],
    recurringTasks: [],
    completedTasks: [],
    criticalDates: [],
    howTo: [],
    tools: [],
    stakeholders: [],
    accessItems: [],
    institutionalMemory: record.institutionalMemory ?? {},
    riskScore: record.riskScore ?? 0,
    riskLevel: (record.riskScore ?? 0) >= 60 ? "high" : (record.riskScore ?? 0) >= 30 ? "medium" : "low",
    riskReasons: record.riskSummary ? [record.riskSummary] : [],
    transitionChecklist: [
      "Assign or confirm the current owner for this job title.",
      "Add recurring responsibilities as they are discovered.",
      "Attach tool access and account ownership details.",
      "Review current open work before handoff.",
    ],
    lastUpdatedAt: record.updatedAt ?? record.createdAt,
  };
  return mergeProfileRecord(base, record);
}

export function buildPositionProfiles(
  tasks: Task[],
  users: User[],
  events: TaskEvent[],
  persistedProfiles: PersistedPositionProfile[] = [],
): PositionProfile[] {
  const today = localDateIso();
  const derivedProfiles: PositionProfile[] = users.map((user) => {
    const owned = tasks.filter((task) => String(task.assignedToId) === String(user.id) && task.visibility !== "personal");
    const currentIncompleteTasks = owned.filter((task) => task.status !== "completed" && task.status !== "denied");
    const completedTasks = owned.filter((task) => task.status === "completed");
    const recurringTasks = owned.filter((task) => task.recurrence !== "none" || inferTaskCadence(task) !== "As needed");
    const criticalDates = Array.from(
      new Set(
        owned
          .filter((task) => task.dueDate && (task.recurrence !== "none" || task.urgency === "critical" || task.urgency === "high"))
          .map((task) => `${task.dueDate}: ${task.title}`),
      ),
    ).slice(0, 4);
    const howTo = Array.from(
      new Set(
        owned
          .map(taskKnowledgeText)
          .filter((text) => text.length >= 30)
          .map((text) => text.slice(0, 180)),
      ),
    ).slice(0, 4);
    const stakeholderNames = users
      .filter((candidate) => String(candidate.id) !== String(user.id))
      .filter((candidate) =>
        owned.some((task) => {
          const text = `${task.title} ${task.description} ${task.completionNotes}`.toLowerCase();
          return text.includes(candidate.name.toLowerCase()) || String(task.assignedById) === String(candidate.id);
        }),
      )
      .map((candidate) => candidate.name)
      .slice(0, 4);
    const overdue = currentIncompleteTasks.filter((task) => task.dueDate && task.dueDate < today);
    const high = currentIncompleteTasks.filter((task) => task.urgency === "critical" || task.urgency === "high");
    const missingHowTo = recurringTasks.filter((task) => taskKnowledgeText(task).length < 30);
    const riskScore = Math.min(
      100,
      overdue.length * 24 +
        high.length * 12 +
        Math.max(0, currentIncompleteTasks.length - 5) * 4 +
        missingHowTo.length * 8 +
        (inferToolsFromTasks(owned).length === 0 && owned.length > 0 ? 8 : 0),
    );
    const riskReasons = [
      overdue.length > 0 ? `${overdue.length} overdue task${overdue.length === 1 ? "" : "s"}` : "",
      high.length > 0 ? `${high.length} high-urgency task${high.length === 1 ? "" : "s"}` : "",
      missingHowTo.length > 0 ? `${missingHowTo.length} recurring item${missingHowTo.length === 1 ? "" : "s"} need better how-to notes` : "",
      currentIncompleteTasks.length > 0 ? `${currentIncompleteTasks.length} active task${currentIncompleteTasks.length === 1 ? "" : "s"} to cover` : "",
    ].filter(Boolean);
    const recentEvents = events
      .filter((event) => owned.some((task) => String(task.id) === String(event.taskId)))
      .map((event) => event.createdAt)
      .sort()
      .at(-1);
    const title = positionTitleForUser(user);
    return {
      id: `position-${String(user.id)}`,
      persisted: false,
      title,
      owner: user,
      currentOwnerId: user.id,
      directManagerId: user.managerId,
      temporaryOwnerId: null,
      delegateUserId: null,
      delegateUntil: null,
      status: currentIncompleteTasks.some((task) => task.delegatedToId) ? "covered" : "active",
      currentIncompleteTasks,
      recurringTasks,
      completedTasks,
      criticalDates,
      howTo,
      tools: inferToolsFromTasks(owned),
      stakeholders: stakeholderNames,
      accessItems: [],
      institutionalMemory: {},
      riskScore,
      riskLevel: riskScore >= 60 ? "high" : riskScore >= 30 ? "medium" : "low",
      riskReasons,
      transitionChecklist: [
        `Review ${currentIncompleteTasks.length} current incomplete task${currentIncompleteTasks.length === 1 ? "" : "s"}.`,
        recurringTasks.length > 0
          ? `Confirm next occurrence for ${recurringTasks.length} recurring ${recurringTasks.length === 1 ? "responsibility" : "responsibilities"}.`
          : "Confirm whether this role has recurring responsibilities.",
        "Verify tool access, account ownership, billing, and recovery contacts.",
        howTo.length > 0 ? "Review saved how-to context before reassigning." : "Add how-to notes for recurring responsibilities.",
        "Assign the profile owner or set a delegate coverage period.",
      ],
      lastUpdatedAt: recentEvents ?? owned.map((task) => task.createdAt).sort().at(-1) ?? null,
    } satisfies PositionProfile;
  });

  const usedRecordIds = new Set<string>();
  const merged = derivedProfiles.map((profile) => {
    const record = persistedProfiles.find((item) => String(item.currentOwnerId) === String(profile.owner.id));
    if (!record) return profile;
    usedRecordIds.add(record.id);
    const profileTasks = tasks.filter(
      (task) =>
        task.visibility !== "personal" &&
        (String(task.positionProfileId ?? "") === record.id || String(task.assignedToId) === String(profile.owner.id)),
    );
    return mergeProfileRecord(
      {
        ...profile,
        currentIncompleteTasks: profileTasks.filter((task) => task.status !== "completed" && task.status !== "denied"),
        recurringTasks: profileTasks.filter((task) => task.recurrence !== "none" || inferTaskCadence(task) !== "As needed"),
        completedTasks: profileTasks.filter((task) => task.status === "completed"),
      },
      record,
    );
  });
  for (const record of persistedProfiles) {
    if (usedRecordIds.has(record.id)) continue;
    const profile = buildEmptyPositionProfile(record, users);
    if (profile) merged.push(profile);
  }
  return merged.sort((a, b) => a.title.localeCompare(b.title));
}

export function profilePrimaryOwnerId(profile: PositionProfile) {
  return profile.currentOwnerId ?? profile.owner.id;
}

export function profilesForUser(positionProfiles: PositionProfile[], userId: Id) {
  const id = String(userId);
  return positionProfiles.filter(
    (profile) =>
      String(profilePrimaryOwnerId(profile)) === id ||
      String(profile.temporaryOwnerId ?? "") === id ||
      String(profile.delegateUserId ?? "") === id,
  );
}

export function profileAssignmentLabel(profile: PositionProfile, users: User[]) {
  const owner = users.find((user) => String(user.id) === String(profilePrimaryOwnerId(profile)));
  const temporary = users.find((user) => String(user.id) === String(profile.temporaryOwnerId));
  const delegate = users.find((user) => String(user.id) === String(profile.delegateUserId));
  const ownerLabel = owner?.name ?? "Vacant";
  const coverage = [
    temporary ? `covered by ${temporary.name}` : "",
    delegate ? `delegated to ${delegate.name}` : "",
  ].filter(Boolean);
  return coverage.length > 0 ? `${ownerLabel}, ${coverage.join(", ")}` : ownerLabel;
}
