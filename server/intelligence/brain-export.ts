// Phase 1 D3 — Brain vault export helpers.
//
// Produces an Obsidian-compatible markdown file per donnit.position_profile_knowledge
// row. The zip is built in the route handler; this module owns the pure
// transformations so they can be unit-tested without the network.

import type { DonnitPositionProfile, DonnitPositionProfileKnowledge } from "../donnit-store";

const MAX_EXPORT_ROWS = 5000;

export const POSITION_BRAIN_EXPORT_LIMIT = MAX_EXPORT_ROWS;

const SAFE_SLUG_CHARS = /[^a-z0-9]+/g;
const TRIM_DASHES = /(^-+|-+$)/g;
const HAS_ALPHANUMERIC = /[a-z0-9]/;

/** Lowercase kebab-case slug restricted to [a-z0-9-]. Falls back to a short id, then to "position". */
export function slugifyPositionTitle(title: string, fallbackId: string): string {
  const cleaned = (title ?? "")
    .toLowerCase()
    .replace(SAFE_SLUG_CHARS, "-")
    .replace(TRIM_DASHES, "");
  if (cleaned.length > 0 && HAS_ALPHANUMERIC.test(cleaned)) return cleaned.slice(0, 80);

  const fromId = (fallbackId ?? "")
    .toLowerCase()
    .replace(SAFE_SLUG_CHARS, "-")
    .replace(TRIM_DASHES, "")
    .slice(0, 8);
  if (fromId.length > 0 && HAS_ALPHANUMERIC.test(fromId)) return fromId;

  return "position";
}

/** Escape a string for safe inclusion in a YAML double-quoted scalar. */
function escapeYamlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ");
}

function formatYamlScalar(key: string, value: unknown): string {
  if (value === null || value === undefined) return `${key}: null`;
  if (typeof value === "number" || typeof value === "boolean") return `${key}: ${value}`;
  return `${key}: "${escapeYamlString(String(value))}"`;
}

/** Produce the `.md` content (frontmatter + body) for a single knowledge row. */
export function buildKnowledgeMarkdown(row: DonnitPositionProfileKnowledge): string {
  const lines: string[] = ["---"];
  lines.push(formatYamlScalar("kind", row.kind));
  lines.push(formatYamlScalar("title", row.title ?? ""));
  lines.push(formatYamlScalar("status", row.status ?? "active"));
  lines.push(formatYamlScalar("confidence_score", row.confidence_score ?? null));
  lines.push(formatYamlScalar("importance", row.importance ?? null));
  lines.push(formatYamlScalar("source_kind", row.source_kind ?? ""));
  lines.push(formatYamlScalar("source_ref", row.source_ref ?? ""));
  lines.push(formatYamlScalar("last_seen_at", row.last_seen_at ?? ""));
  lines.push(formatYamlScalar("memory_key", row.memory_key ?? ""));
  lines.push("---");
  lines.push("");

  // Prefer markdown_body; fall back to body if markdown is empty.
  const body = (row.markdown_body && row.markdown_body.trim().length > 0
    ? row.markdown_body
    : (row.body ?? "")).trimEnd();
  if (body.length > 0) {
    lines.push(body);
    lines.push("");
  }
  return lines.join("\n");
}

const SAFE_FILE_NAME = /[^a-zA-Z0-9._-]/g;

/** Produce the path inside the zip for a knowledge row. */
export function buildKnowledgeFilePath(positionSlug: string, row: DonnitPositionProfileKnowledge): string {
  const safeKind = (row.kind ?? "unknown").replace(SAFE_FILE_NAME, "-");
  // memory_key may be present-but-empty in legacy rows; fall back to row.id, then to "row".
  const keySource = (row.memory_key && row.memory_key.length > 0)
    ? row.memory_key
    : (row.id && row.id.length > 0 ? row.id : "row");
  const safeKey = keySource.replace(SAFE_FILE_NAME, "-").slice(0, 80);
  return `${positionSlug}/${safeKind}/${safeKey}.md`;
}

/** Produce the Content-Disposition filename for the downloaded zip. */
export function buildExportZipFilename(position: Pick<DonnitPositionProfile, "id" | "title">): string {
  const slug = slugifyPositionTitle(position.title ?? "", position.id ?? "position");
  return `${slug}-brain.zip`;
}
