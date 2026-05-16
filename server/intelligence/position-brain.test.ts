import { describe, expect, it } from "vitest";
import type { DonnitPositionProfileKnowledge } from "../donnit-store";
import {
  POSITION_KNOWLEDGE_KIND_ORDER,
  groupPositionKnowledgeByKind,
} from "./position-brain";

function row(
  kind: string,
  overrides: Partial<DonnitPositionProfileKnowledge> = {},
): DonnitPositionProfileKnowledge {
  return {
    id: overrides.id ?? `id-${kind}-${Math.random().toString(36).slice(2, 8)}`,
    org_id: overrides.org_id ?? "org-a",
    position_profile_id: overrides.position_profile_id ?? "pos-1",
    kind: kind as DonnitPositionProfileKnowledge["kind"],
    title: overrides.title ?? `${kind} title`,
    body: overrides.body ?? "",
    markdown_body: overrides.markdown_body ?? "",
    source_kind: (overrides.source_kind ?? "task") as DonnitPositionProfileKnowledge["source_kind"],
    source_ref: overrides.source_ref ?? "",
    source_event_id: overrides.source_event_id ?? null,
    source_task_id: overrides.source_task_id ?? null,
    evidence: overrides.evidence ?? {},
    status: (overrides.status ?? "active") as DonnitPositionProfileKnowledge["status"],
    importance: overrides.importance ?? 50,
    confidence_score: overrides.confidence_score ?? 0.6,
    confidence: overrides.confidence ?? 0.6,
    memory_key: overrides.memory_key ?? `key-${Math.random().toString(36).slice(2, 8)}`,
    created_by: overrides.created_by ?? null,
    created_at: overrides.created_at ?? new Date().toISOString(),
    updated_at: overrides.updated_at ?? new Date().toISOString(),
    last_seen_at: overrides.last_seen_at ?? new Date().toISOString(),
    archived_at: overrides.archived_at ?? null,
  } as DonnitPositionProfileKnowledge;
}

describe("groupPositionKnowledgeByKind", () => {
  it("returns an empty object when no rows are provided", () => {
    expect(groupPositionKnowledgeByKind([])).toEqual({});
  });

  it("groups rows by kind and preserves input order within each group", () => {
    const a = row("decision_rule", { id: "a", title: "rule a" });
    const b = row("decision_rule", { id: "b", title: "rule b" });
    const c = row("tool", { id: "c", title: "tool c" });
    const grouped = groupPositionKnowledgeByKind([a, b, c]);
    expect(grouped.decision_rule.map((r) => r.id)).toEqual(["a", "b"]);
    expect(grouped.tool.map((r) => r.id)).toEqual(["c"]);
  });

  it("orders the kind groups according to POSITION_KNOWLEDGE_KIND_ORDER", () => {
    // Intentionally insert in reverse-canonical order to confirm the helper sorts groups.
    const inputs = [...POSITION_KNOWLEDGE_KIND_ORDER]
      .slice()
      .reverse()
      .map((kind) => row(kind));
    const grouped = groupPositionKnowledgeByKind(inputs);
    const seen = Object.keys(grouped);
    // Should be in the canonical order, not the input (reverse) order.
    const canonicalSubset = POSITION_KNOWLEDGE_KIND_ORDER.filter((k) => seen.includes(k));
    expect(seen).toEqual(canonicalSubset);
  });

  it("omits kind keys that have zero rows", () => {
    const grouped = groupPositionKnowledgeByKind([row("decision_rule")]);
    expect(Object.keys(grouped)).toEqual(["decision_rule"]);
  });

  it("appends unknown kinds (forward-compatible) after known kinds", () => {
    const known = row("decision_rule");
    const unknown = row("future_kind" as unknown as DonnitPositionProfileKnowledge["kind"]);
    const grouped = groupPositionKnowledgeByKind([unknown, known]);
    const keys = Object.keys(grouped);
    expect(keys.indexOf("decision_rule")).toBeLessThan(keys.indexOf("future_kind"));
    expect(grouped.future_kind).toHaveLength(1);
  });
});
