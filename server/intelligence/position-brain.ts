// Phase 1 D2 — Brain tab helpers.
//
// Groups donnit.position_profile_knowledge rows by `kind` for the admin-only
// Brain tab on Position Profile. The 11 `kind` values are part of the
// contract (see CLAUDE.md §6); preserve their ordering when surfacing to UI.

import type { DonnitPositionProfileKnowledge } from "../donnit-store";

// Canonical kind ordering for the UI. Importance: most "decision-y" kinds
// first, identity/relationship kinds in the middle, descriptive last.
export const POSITION_KNOWLEDGE_KIND_ORDER = [
  "handoff_note",
  "decision_rule",
  "recurring_responsibility",
  "process",
  "how_to",
  "relationship",
  "stakeholder",
  "tool",
  "preference",
  "risk",
  "critical_date",
] as const;

export type PositionKnowledgeKind = (typeof POSITION_KNOWLEDGE_KIND_ORDER)[number];

export type PositionKnowledgeByKind = Record<string, DonnitPositionProfileKnowledge[]>;

/**
 * Group knowledge rows by kind. Rows within each group keep the order they
 * arrived in (the store already sorts by `importance desc, last_seen_at desc`).
 * The returned object's key order matches POSITION_KNOWLEDGE_KIND_ORDER for
 * predictable rendering; unknown kinds (in case the enum grows in the future)
 * are appended in the order they first appear.
 */
export function groupPositionKnowledgeByKind(
  rows: DonnitPositionProfileKnowledge[],
): PositionKnowledgeByKind {
  const grouped: PositionKnowledgeByKind = {};
  for (const kind of POSITION_KNOWLEDGE_KIND_ORDER) {
    const matches = rows.filter((row) => row.kind === kind);
    if (matches.length > 0) grouped[kind] = matches;
  }
  const known = new Set<string>(POSITION_KNOWLEDGE_KIND_ORDER);
  for (const row of rows) {
    if (!known.has(row.kind)) {
      (grouped[row.kind] ??= []).push(row);
    }
  }
  return grouped;
}
