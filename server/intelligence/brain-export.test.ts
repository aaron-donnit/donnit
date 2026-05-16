import { describe, expect, it } from "vitest";
import type { DonnitPositionProfileKnowledge } from "../donnit-store";
import {
  POSITION_BRAIN_EXPORT_LIMIT,
  buildExportZipFilename,
  buildKnowledgeFilePath,
  buildKnowledgeMarkdown,
  slugifyPositionTitle,
} from "./brain-export";

function row(overrides: Partial<DonnitPositionProfileKnowledge> = {}): DonnitPositionProfileKnowledge {
  return {
    id: overrides.id ?? "id-xyz",
    org_id: overrides.org_id ?? "org-a",
    position_profile_id: overrides.position_profile_id ?? "pos-1",
    kind: (overrides.kind ?? "decision_rule") as DonnitPositionProfileKnowledge["kind"],
    title: overrides.title ?? "Sample title",
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
    memory_key: overrides.memory_key ?? "key-123",
    created_by: overrides.created_by ?? null,
    created_at: overrides.created_at ?? "2026-05-14T18:00:00Z",
    updated_at: overrides.updated_at ?? "2026-05-14T18:00:00Z",
    last_seen_at: overrides.last_seen_at ?? "2026-05-14T18:00:00Z",
    archived_at: overrides.archived_at ?? null,
  } as DonnitPositionProfileKnowledge;
}

describe("slugifyPositionTitle", () => {
  it("kebab-cases an ordinary title", () => {
    expect(slugifyPositionTitle("Executive Assistant to the CEO", "fallback")).toBe("executive-assistant-to-the-ceo");
  });

  it("strips special characters and double dashes", () => {
    expect(slugifyPositionTitle("Sales — Ops & Reporting!!", "fb")).toBe("sales-ops-reporting");
  });

  it("falls back to a short id when title is empty", () => {
    expect(slugifyPositionTitle("", "abc12345-de67-89ab-cdef-0123456789ab")).toBe("abc12345");
  });

  it("returns 'position' if both title and id are unsafe", () => {
    expect(slugifyPositionTitle("", "")).toBe("position");
    expect(slugifyPositionTitle("$$$", "$$$")).toBe("position");
  });

  it("caps slug length at 80 chars", () => {
    const long = "a".repeat(120);
    const slug = slugifyPositionTitle(long, "fb");
    expect(slug.length).toBe(80);
  });
});

describe("buildKnowledgeMarkdown", () => {
  it("includes YAML frontmatter with all expected fields", () => {
    const md = buildKnowledgeMarkdown(row({
      title: "Quarterly board packet",
      kind: "handoff_note" as DonnitPositionProfileKnowledge["kind"],
      confidence_score: 0.91,
      importance: 80,
      source_kind: "task_event" as DonnitPositionProfileKnowledge["source_kind"],
      source_ref: "task:abc123",
      last_seen_at: "2026-05-14T18:32:01Z",
      memory_key: "key-board-packet",
      markdown_body: "# How to assemble it\n\n- step 1\n- step 2",
    }));
    expect(md).toMatch(/^---\n/);
    expect(md).toContain('kind: "handoff_note"');
    expect(md).toContain('title: "Quarterly board packet"');
    expect(md).toContain("confidence_score: 0.91");
    expect(md).toContain("importance: 80");
    expect(md).toContain('source_kind: "task_event"');
    expect(md).toContain('source_ref: "task:abc123"');
    expect(md).toContain('memory_key: "key-board-packet"');
    expect(md).toContain("# How to assemble it");
    expect(md).toContain("- step 1");
  });

  it("escapes quotes in title", () => {
    const md = buildKnowledgeMarkdown(row({ title: 'CEO "war room" prep' }));
    expect(md).toContain('title: "CEO \\"war room\\" prep"');
  });

  it("falls back to body if markdown_body is empty", () => {
    const md = buildKnowledgeMarkdown(row({ markdown_body: "", body: "legacy body text" }));
    expect(md).toContain("legacy body text");
  });

  it("renders cleanly when both bodies are empty", () => {
    const md = buildKnowledgeMarkdown(row({ markdown_body: "", body: "" }));
    expect(md).toMatch(/^---\n[\s\S]+\n---\n$/);
  });
});

describe("buildKnowledgeFilePath", () => {
  it("uses position slug, kind, and memory_key as the file path", () => {
    const path = buildKnowledgeFilePath("executive-assistant", row({
      kind: "decision_rule" as DonnitPositionProfileKnowledge["kind"],
      memory_key: "rule-budget-approval",
    }));
    expect(path).toBe("executive-assistant/decision_rule/rule-budget-approval.md");
  });

  it("falls back to id when memory_key is missing", () => {
    const path = buildKnowledgeFilePath("ea", row({ memory_key: "" }));
    expect(path).toBe("ea/decision_rule/id-xyz.md");
  });

  it("sanitizes unsafe characters in memory_key and kind", () => {
    const path = buildKnowledgeFilePath("ea", row({
      kind: "decision_rule" as DonnitPositionProfileKnowledge["kind"],
      memory_key: "key with spaces/and/slashes",
    }));
    expect(path).toBe("ea/decision_rule/key-with-spaces-and-slashes.md");
  });
});

describe("buildExportZipFilename", () => {
  it("composes the filename from the slugified position title", () => {
    expect(buildExportZipFilename({ id: "pos-1", title: "Executive Assistant" })).toBe("executive-assistant-brain.zip");
  });

  it("uses fallback id when title is missing", () => {
    expect(buildExportZipFilename({ id: "abc12345-uuid", title: "" })).toBe("abc12345-brain.zip");
  });
});

describe("POSITION_BRAIN_EXPORT_LIMIT", () => {
  it("is documented as 5000", () => {
    expect(POSITION_BRAIN_EXPORT_LIMIT).toBe(5000);
  });
});
