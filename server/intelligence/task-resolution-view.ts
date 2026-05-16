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

/** Pull the `resolution_output.resolved` map into a flat array of summaries. */
export function summarizeResolvedEntities(resolutionOutput: Record<string, unknown>): ResolvedEntitySummary[] {
  const resolved = (resolutionOutput?.resolved && typeof resolutionOutput.resolved === "object")
    ? (resolutionOutput.resolved as Record<string, unknown>)
    : {};
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

/**
 * Pick up to N candidate previews from the candidate_snapshot for the admin view.
 * The shape of candidate_snapshot is implementation-defined by the resolver
 * (see server/intelligence/openai-agent.ts and chat-parser). We accept either
 * a flat array of {display_name, confidence, ...} entries OR a record of
 * field -> array. Unknown shapes return [].
 */
export function previewCandidates(
  candidateSnapshot: Record<string, unknown>,
  limit = 3,
): CandidatePreview[] {
  const flattened: CandidatePreview[] = [];
  function pushFrom(field: string, arr: unknown): void {
    if (!Array.isArray(arr)) return;
    for (const entry of arr) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      flattened.push({
        field,
        display_name: String(e.display_name ?? e.name ?? e.title ?? e.id ?? "(unknown)"),
        confidence: typeof e.confidence === "number" ? e.confidence : (typeof e.score === "number" ? e.score : null),
        source: typeof e.source === "string" ? e.source : null,
      });
    }
  }
  // Record-of-arrays form (most likely).
  for (const [field, arr] of Object.entries(candidateSnapshot ?? {})) {
    if (Array.isArray(arr)) pushFrom(field, arr);
  }
  // Flat-array form fallback.
  if (flattened.length === 0 && Array.isArray(candidateSnapshot as unknown)) {
    pushFrom("candidates", candidateSnapshot as unknown);
  }
  // Rank by confidence DESC so a "top N" preview shows the strongest candidates
  // across all fields, not just the first field's first entries.
  flattened.sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1));
  return flattened.slice(0, limit);
}

export function adminResolutionView(event: DonnitTaskResolutionEvent): AdminResolutionView {
  return {
    view: "admin",
    decision: event.decision,
    parsed_slots: event.parsed_slots ?? {},
    resolved: summarizeResolvedEntities(event.resolution_output ?? {}),
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
    resolved: summarizeResolvedEntities(event.resolution_output ?? {}),
    created_at: event.created_at,
  };
}
