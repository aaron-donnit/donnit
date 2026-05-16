// Phase 1 D5 — "Why did Donnit route this?" view shaping.
//
// Pure transformations that turn a donnit.task_resolution_events row into
// either the admin view (full detail) or the member view (redacted).
// Lives in its own module so it's testable without the route layer.

import type { DonnitTaskResolutionEvent } from "../donnit-store";

export interface ResolvedEntitySummary {
  field: string;
  value: unknown;
  confidence: number | null;
  inferred: boolean;
  reason: string | null;
}

export interface CandidatePreview {
  field: string;
  display_name: string;
  confidence: number | null;
  source: string | null;
}

export interface AdminResolutionView {
  view: "admin";
  decision: string;
  parsed_slots: Record<string, unknown>;
  resolved: ResolvedEntitySummary[];
  candidate_preview: CandidatePreview[];
  confidence_score: number | null;
  source: string;
  model: string | null;
  latency_ms: number;
  cost_usd: number;
  signal_type: string | null;
  signal_strength: number | null;
  created_at: string;
}

export interface MemberResolutionView {
  view: "member";
  decision: string;
  parsed_slots: Record<string, unknown>;
  resolved: ResolvedEntitySummary[];
  created_at: string;
}

export type ResolutionView = AdminResolutionView | MemberResolutionView;

/**
 * Pull `resolution_output` into a flat array of summaries. Donnit's chat
 * resolver writes a FLAT shape today (server/routes.ts:logChatResolutionEvent):
 *   { title, assignedToId, positionProfileId, dueDate, urgency, recurrence,
 *     visibility, missing, decision }
 *
 * The canonical/future-architecture shape from the task-resolution-memory
 * design doc is nested:
 *   { resolved: { assignee: { value, confidence, inferred, reason }, ... } }
 *
 * This adapter handles both. Per-field confidence isn't tracked in the flat
 * shape; pass the event's overall `eventConfidence` so we can attribute it
 * to the assignee/profile fields the resolver actually scored.
 */
const FLAT_TO_CANONICAL_FIELDS: Record<string, string> = {
  title: "title",
  assignedToId: "assignee",
  positionProfileId: "position_profile",
  dueDate: "due",
  urgency: "urgency",
  recurrence: "recurrence",
  visibility: "visibility",
};

// Fields whose confidence comes from the event-level workspace-resolution score.
const SCORED_FROM_EVENT_CONFIDENCE = new Set(["assignee", "position_profile"]);

export function summarizeResolvedEntities(
  resolutionOutput: Record<string, unknown>,
  eventConfidence: number | null = null,
): ResolvedEntitySummary[] {
  // Canonical nested shape — preferred when present.
  if (resolutionOutput?.resolved && typeof resolutionOutput.resolved === "object") {
    const resolved = resolutionOutput.resolved as Record<string, unknown>;
    const summaries: ResolvedEntitySummary[] = [];
    for (const [field, raw] of Object.entries(resolved)) {
      if (!raw || typeof raw !== "object") {
        summaries.push({ field, value: raw ?? null, confidence: null, inferred: false, reason: null });
        continue;
      }
      const obj = raw as Record<string, unknown>;
      const value = "value" in obj ? obj.value : ("display_name" in obj ? obj.display_name : null);
      const confidence = typeof obj.confidence === "number" ? obj.confidence : null;
      const inferred = obj.inferred === true;
      const reason = typeof obj.reason === "string" ? obj.reason : null;
      summaries.push({ field, value: value ?? null, confidence, inferred, reason });
    }
    return summaries;
  }

  // Flat shape adapter — what the chat resolver actually writes today.
  const summaries: ResolvedEntitySummary[] = [];
  for (const [flatKey, canonicalField] of Object.entries(FLAT_TO_CANONICAL_FIELDS)) {
    if (!(flatKey in resolutionOutput)) continue;
    const value = resolutionOutput[flatKey];
    if (value === null || value === undefined) continue;
    summaries.push({
      field: canonicalField,
      value,
      confidence: SCORED_FROM_EVENT_CONFIDENCE.has(canonicalField) ? eventConfidence : null,
      inferred: false,
      reason: null,
    });
  }
  return summaries;
}

/**
 * Pick up to N candidate previews from the candidate_snapshot for the admin view.
 * The shape of candidate_snapshot is implementation-defined by the resolver
 * (see server/intelligence/openai-agent.ts and chat-parser). We accept either
 * a flat array of {display_name, confidence, ...} entries OR a record of
 * field -> array. Unknown shapes return [].
 */
/**
 * Flatten a candidate_snapshot into a ranked preview. Handles three shapes:
 *
 * 1. Canonical future-architecture: `{ field: Candidate[], ... }` where each
 *    Candidate is `{ display_name, confidence, source, ... }`.
 * 2. Flat array fallback: a top-level array of candidates.
 * 3. **Chat-resolver shape (current)**: `{ matchedPhrase, confidence,
 *    resolvedMember, resolvedProfile, ambiguousMembers, ambiguousProfiles,
 *    mentionedProfiles }`. The resolver picks one member + one profile and
 *    optionally lists ambiguous alternatives.
 *
 * Returns up to `limit` entries, ranked by confidence DESC.
 */
export function previewCandidates(
  candidateSnapshot: Record<string, unknown>,
  limit = 3,
): CandidatePreview[] {
  if (!candidateSnapshot || typeof candidateSnapshot !== "object") return [];

  const flattened: CandidatePreview[] = [];

  function summaryToPreview(field: string, raw: unknown, source: string | null = null): CandidatePreview | null {
    if (!raw || typeof raw !== "object") return null;
    const e = raw as Record<string, unknown>;
    return {
      field,
      display_name: String(e.display_name ?? e.name ?? e.title ?? e.full_name ?? e.id ?? "(unknown)"),
      confidence: typeof e.confidence === "number" ? e.confidence : (typeof e.score === "number" ? e.score : null),
      source: source ?? (typeof e.source === "string" ? e.source : null),
    };
  }

  // Shape #3 — chat-resolver-specific keys we know about. Try first because
  // its keys are distinctive (resolvedMember, ambiguousMembers, etc.).
  const eventConfidence = typeof candidateSnapshot.confidence === "number"
    ? (candidateSnapshot.confidence as number)
    : null;
  const matchedPhrase = typeof candidateSnapshot.matchedPhrase === "string"
    ? (candidateSnapshot.matchedPhrase as string)
    : null;
  const chatKeys = ["resolvedMember", "resolvedProfile", "ambiguousMembers", "ambiguousProfiles", "mentionedProfiles"];
  const looksLikeChatShape = chatKeys.some((k) => k in candidateSnapshot);

  if (looksLikeChatShape) {
    const resolvedMember = summaryToPreview("assignee", candidateSnapshot.resolvedMember, matchedPhrase ? `via "${matchedPhrase}"` : null);
    if (resolvedMember) {
      if (resolvedMember.confidence === null && eventConfidence !== null) resolvedMember.confidence = eventConfidence;
      flattened.push(resolvedMember);
    }
    const resolvedProfile = summaryToPreview("position_profile", candidateSnapshot.resolvedProfile, "primary profile");
    if (resolvedProfile) {
      if (resolvedProfile.confidence === null && eventConfidence !== null) resolvedProfile.confidence = eventConfidence;
      flattened.push(resolvedProfile);
    }
    if (Array.isArray(candidateSnapshot.ambiguousMembers)) {
      for (const raw of candidateSnapshot.ambiguousMembers) {
        const p = summaryToPreview("assignee", raw, "ambiguous match");
        if (p) flattened.push(p);
      }
    }
    if (Array.isArray(candidateSnapshot.ambiguousProfiles)) {
      for (const raw of candidateSnapshot.ambiguousProfiles) {
        const p = summaryToPreview("position_profile", raw, "ambiguous match");
        if (p) flattened.push(p);
      }
    }
  } else {
    // Shape #1 — record-of-arrays (canonical future).
    for (const [field, value] of Object.entries(candidateSnapshot)) {
      if (Array.isArray(value)) {
        for (const raw of value) {
          const p = summaryToPreview(field, raw);
          if (p) flattened.push(p);
        }
      }
    }
    // Shape #2 — flat array fallback.
    if (flattened.length === 0 && Array.isArray(candidateSnapshot as unknown)) {
      for (const raw of candidateSnapshot as unknown as unknown[]) {
        const p = summaryToPreview("candidates", raw);
        if (p) flattened.push(p);
      }
    }
  }

  // Rank by confidence DESC so the strongest candidates surface first across fields.
  flattened.sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1));
  return flattened.slice(0, limit);
}

export function adminResolutionView(event: DonnitTaskResolutionEvent): AdminResolutionView {
  return {
    view: "admin",
    decision: event.decision,
    parsed_slots: event.parsed_slots ?? {},
    resolved: summarizeResolvedEntities(event.resolution_output ?? {}, event.confidence_score ?? null),
    candidate_preview: previewCandidates(event.candidate_snapshot ?? {}),
    confidence_score: event.confidence_score ?? null,
    source: event.source,
    model: event.model ?? null,
    latency_ms: event.latency_ms ?? 0,
    cost_usd: event.cost_usd ?? 0,
    signal_type: event.signal_type ?? null,
    signal_strength: event.signal_strength ?? null,
    created_at: event.created_at,
  };
}

export function memberResolutionView(event: DonnitTaskResolutionEvent): MemberResolutionView {
  return {
    view: "member",
    decision: event.decision,
    parsed_slots: event.parsed_slots ?? {},
    resolved: summarizeResolvedEntities(event.resolution_output ?? {}, event.confidence_score ?? null),
    created_at: event.created_at,
  };
}
