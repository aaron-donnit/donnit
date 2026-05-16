import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Brain, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { Id } from "@/app/types";

// View shape returned by GET /api/tasks/:id/resolution.
// Server-side redaction means non-admin members get a strict subset of fields.
// See server/intelligence/task-resolution-view.ts for the canonical types.
type ResolvedEntity = {
  field: string;
  value: unknown;
  confidence: number | null;
  inferred: boolean;
  reason: string | null;
};

type CandidatePreview = {
  field: string;
  display_name: string;
  confidence: number | null;
  source: string | null;
};

type BaseResolutionView = {
  decision: string;
  parsed_slots: Record<string, unknown>;
  resolved: ResolvedEntity[];
  created_at: string;
};

type MemberView = BaseResolutionView & { view: "member" };

type AdminView = BaseResolutionView & {
  view: "admin";
  candidate_preview: CandidatePreview[];
  confidence_score: number | null;
  source: string;
  model: string | null;
  latency_ms: number;
  cost_usd: number;
  signal_type: string | null;
  signal_strength: number | null;
};

type ResolutionView = MemberView | AdminView;

const PHRASE_LABELS: Record<string, string> = {
  assignee_phrase: "Who",
  object_phrase: "What",
  temporal_phrase: "When",
  priority_phrase: "Priority phrase",
  privacy_phrase: "Privacy phrase",
  recurrence_phrase: "Recurrence",
};

const FIELD_LABELS: Record<string, string> = {
  assignee: "Assignee",
  title: "Title",
  due: "Due",
  position_profile: "Position profile",
  recurrence: "Recurrence",
  intent: "Intent",
};

function formatPercent(n: number | null): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "(value)";
  }
}

interface TaskResolutionAccordionProps {
  taskId: Id | string;
}

export default function TaskResolutionAccordion({ taskId }: TaskResolutionAccordionProps) {
  const [open, setOpen] = useState(false);
  const [adminDetailsOpen, setAdminDetailsOpen] = useState(false);

  const query = useQuery<ResolutionView | null>({
    queryKey: ["task-resolution", String(taskId)],
    enabled: Boolean(taskId),
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", `/api/tasks/${taskId}/resolution`);
        return (await res.json()) as ResolutionView;
      } catch (err) {
        // 404 is the common path (task was created manually, no resolution event).
        // apiRequest throws on non-OK; treat 404 as null instead of propagating.
        const message = err instanceof Error ? err.message : "";
        if (message.includes("404") || message.toLowerCase().includes("not found")) {
          return null;
        }
        throw err;
      }
    },
    retry: false,
    staleTime: 60_000,
  });

  if (query.isLoading) return null;
  if (!query.data) return null; // No resolution event — render nothing.

  const data = query.data;

  return (
    <section className="rounded-md border border-border bg-card" data-testid="task-resolution-accordion">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Brain className="size-4" />
          Why did Donnit route this?
        </span>
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
      </button>

      {open && (
        <div className="space-y-4 border-t border-border px-3 py-3">
          {/* Parsed phrases */}
          {Object.keys(data.parsed_slots ?? {}).length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Parsed phrases</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(data.parsed_slots).map(([key, value]) => {
                  if (!value) return null;
                  return (
                    <span key={key} className="inline-flex items-baseline gap-1 rounded-md bg-muted px-2 py-0.5 text-xs">
                      <span className="text-muted-foreground">{PHRASE_LABELS[key] ?? key}:</span>
                      <span className="font-medium text-foreground">{formatValue(value)}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Resolved entities */}
          {data.resolved.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Resolved</p>
              <ul className="space-y-1">
                {data.resolved.map((entity) => (
                  <li key={entity.field} className="flex flex-wrap items-baseline gap-2 text-xs">
                    <span className="text-muted-foreground">{FIELD_LABELS[entity.field] ?? entity.field}:</span>
                    <span className="font-medium text-foreground">{formatValue(entity.value)}</span>
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {formatPercent(entity.confidence)}
                    </span>
                    {entity.inferred && (
                      <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800 ring-1 ring-inset ring-amber-200">
                        inferred
                      </span>
                    )}
                    {entity.reason && (
                      <span className="text-[11px] italic text-muted-foreground">— {entity.reason}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Decision */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Decision:</span>
            <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-emerald-900 ring-1 ring-inset ring-emerald-200">
              {data.decision}
            </span>
            <span className="ml-auto text-muted-foreground">{new Date(data.created_at).toLocaleString()}</span>
          </div>

          {/* Admin-only sub-accordion */}
          {data.view === "admin" && (
            <div className="rounded-md border border-dashed border-border p-2">
              <button
                type="button"
                onClick={() => setAdminDetailsOpen((o) => !o)}
                className="flex w-full items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                aria-expanded={adminDetailsOpen}
              >
                {adminDetailsOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                Admin details (model, cost, candidates)
              </button>
              {adminDetailsOpen && (
                <div className="mt-2 space-y-2 text-xs">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {data.model && (
                      <>
                        <dt className="text-muted-foreground">Model</dt>
                        <dd className="text-foreground">{data.model}</dd>
                      </>
                    )}
                    <dt className="text-muted-foreground">Latency</dt>
                    <dd className="text-foreground">{data.latency_ms} ms</dd>
                    <dt className="text-muted-foreground">Cost</dt>
                    <dd className="text-foreground">${data.cost_usd.toFixed(6)}</dd>
                    <dt className="text-muted-foreground">Source</dt>
                    <dd className="text-foreground">{data.source}</dd>
                    {data.signal_type && (
                      <>
                        <dt className="text-muted-foreground">Signal</dt>
                        <dd className="text-foreground">{data.signal_type}</dd>
                      </>
                    )}
                  </dl>
                  {data.candidate_preview.length > 0 && (
                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Top candidates</p>
                      <ul className="space-y-1">
                        {data.candidate_preview.map((cand, idx) => (
                          <li key={`${cand.field}-${idx}`} className="flex flex-wrap items-baseline gap-2">
                            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{cand.field}</span>
                            <span className="text-foreground">{cand.display_name}</span>
                            <span className="text-muted-foreground">{formatPercent(cand.confidence)}</span>
                            {cand.source && <span className="text-[11px] italic text-muted-foreground">via {cand.source}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
