// Phase 2 D1 — user-elective wisdom capture on task completion.
//
// Donnit already auto-captures every task completion as a structural
// `kind: 'process'` row via enrichPositionProfileMemoryFromTask in routes.ts.
// This module adds the OPT-IN, user-typed "wisdom" row alongside that —
// a separate `kind: 'how_to'` row tagged to the same task, populated only
// when the user provides a non-empty memoryNote on completion. Empty input
// is the default and writes nothing.

import type { DonnitStore, DonnitPositionProfileKnowledge } from "../donnit-store";

const MEMORY_KEY_MAX_LEN = 220;

function memoryKeyFromParts(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => String(part ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .join(":")
    .slice(0, MEMORY_KEY_MAX_LEN);
}

export interface CaptureUserWisdomInput {
  store: DonnitStore;
  orgId: string;
  taskId: string;
  positionProfileId: string;
  actorId: string;
  taskTitle: string;
  memoryNote: string;
  /** Optional — when 'personal', the capture is suppressed defensively. */
  visibility?: string | null;
}

export interface CaptureUserWisdomResult {
  knowledge: DonnitPositionProfileKnowledge | null;
  capturedAt: string;
}

/**
 * Insert a user-elective `how_to` row into position_profile_knowledge and an
 * audit row into learning_events. Returns null when the inputs preclude
 * capture (empty note, missing position, or personal-visibility task).
 *
 * Errors from the underlying store are surfaced to the caller. The route
 * handler is expected to catch them so a memory-write failure never breaks
 * task completion itself.
 */
export async function captureUserWisdomFromCompletion(
  input: CaptureUserWisdomInput,
): Promise<CaptureUserWisdomResult | null> {
  const note = (input.memoryNote ?? "").trim();
  if (note.length === 0) return null;
  if (!input.positionProfileId) return null;
  if (input.visibility === "personal") return null;

  const markdownBody = `# ${input.taskTitle || "Task wisdom"}\n\n${note}`;
  const memoryKey = memoryKeyFromParts(["task-completion-wisdom", input.taskId]);

  const knowledge = await input.store.upsertPositionProfileKnowledge(input.orgId, {
    position_profile_id: input.positionProfileId,
    source_task_id: input.taskId,
    kind: "how_to",
    title: input.taskTitle || "Task wisdom",
    body: note,
    markdown_body: markdownBody,
    memory_key: memoryKey,
    source_kind: "task_event",
    confidence: "medium",
    confidence_score: 0.7,
    importance: 60,
    status: "active",
    evidence: { taskId: input.taskId, kind: "user_wisdom" },
    created_by: input.actorId,
  });

  await input.store.createLearningEvent(input.orgId, {
    source: "manual",
    event_type: "task_completion_memory_captured",
    scope_type: "position_profile",
    scope_id: input.positionProfileId,
    position_profile_id: input.positionProfileId,
    task_id: input.taskId,
    source_ref_type: "task_event",
    source_ref_id: knowledge?.id ?? null,
    raw_text: note,
    normalized_text: note,
    interpretation: { kind: "how_to", taskTitle: input.taskTitle },
    signal: { confidence_score: 0.7, importance: 60 },
    confidence_score: 0.7,
    signal_strength: 0.7,
  });

  return { knowledge, capturedAt: new Date().toISOString() };
}
