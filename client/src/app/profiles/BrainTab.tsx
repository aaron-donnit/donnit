import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle, BookOpen, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";
import type { Id } from "@/app/types";

// Mirrors the server-side ordering in server/intelligence/position-brain.ts.
// Kept in sync deliberately so the UI shows kinds in the same priority order
// the API returns them.
const KIND_LABELS: Record<string, string> = {
  handoff_note: "Handoff notes",
  decision_rule: "Decision rules",
  recurring_responsibility: "Recurring responsibilities",
  process: "Processes",
  how_to: "How-tos",
  relationship: "Relationships",
  stakeholder: "Stakeholders",
  tool: "Tools",
  preference: "Preferences",
  risk: "Risks",
  critical_date: "Critical dates",
};

const KIND_TONES: Record<string, string> = {
  handoff_note: "bg-amber-50 text-amber-900 ring-amber-200",
  decision_rule: "bg-violet-50 text-violet-900 ring-violet-200",
  recurring_responsibility: "bg-blue-50 text-blue-900 ring-blue-200",
  process: "bg-sky-50 text-sky-900 ring-sky-200",
  how_to: "bg-emerald-50 text-emerald-900 ring-emerald-200",
  relationship: "bg-pink-50 text-pink-900 ring-pink-200",
  stakeholder: "bg-rose-50 text-rose-900 ring-rose-200",
  tool: "bg-slate-50 text-slate-900 ring-slate-200",
  preference: "bg-teal-50 text-teal-900 ring-teal-200",
  risk: "bg-orange-50 text-orange-900 ring-orange-200",
  critical_date: "bg-yellow-50 text-yellow-900 ring-yellow-200",
};

const SOURCE_LABELS: Record<string, string> = {
  task: "from task",
  task_event: "from task event",
  email: "from email",
  slack: "from Slack",
  sms: "from SMS",
  document: "from document",
  manual: "manual entry",
  assistant: "from assistant",
  profile_transfer: "carried at transfer",
};

export type BrainKnowledgeRow = {
  id: string;
  memory_key: string;
  kind: string;
  title: string;
  markdown_body: string;
  body?: string;
  source_kind: string;
  source_ref: string;
  source_event_id: string | null;
  evidence: Record<string, unknown>;
  status: string;
  importance: number;
  confidence_score: number;
  last_seen_at: string;
  updated_at: string;
};

export type BrainResponse = {
  orgId: string;
  positionProfileId: string;
  knowledgeByKind: Record<string, BrainKnowledgeRow[]>;
  totalCount: number;
};

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffMs = Date.now() - then;
  const min = Math.round(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

function confidencePill(score: number) {
  const pct = Math.round(score * 100);
  let tone = "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (pct < 75) tone = "bg-amber-50 text-amber-700 ring-amber-200";
  if (pct < 50) tone = "bg-rose-50 text-rose-700 ring-rose-200";
  return { pct, tone };
}

interface BrainTabProps {
  /** The position profile id. Required. */
  positionId: Id | string;
  /** Gate the query on the sheet being open AND the user having admin permissions. */
  enabled: boolean;
}

export default function BrainTab({ positionId, enabled }: BrainTabProps) {
  const [downloading, setDownloading] = useState(false);

  const query = useQuery<BrainResponse>({
    queryKey: ["position-brain", String(positionId)],
    enabled: enabled && Boolean(positionId),
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/positions/${positionId}/brain`);
      return (await res.json()) as BrainResponse;
    },
  });

  const groupedEntries = useMemo(() => {
    if (!query.data) return [] as Array<[string, BrainKnowledgeRow[]]>;
    return Object.entries(query.data.knowledgeByKind);
  }, [query.data]);

  async function handleDownload() {
    if (downloading || !positionId) return;
    setDownloading(true);
    try {
      const res = await apiRequest("GET", `/api/positions/${positionId}/brain/export`);
      const blob = await res.blob();
      const dispositionHeader = res.headers.get("content-disposition") ?? "";
      const match = dispositionHeader.match(/filename="?([^";]+)"?/i);
      const filename = match?.[1] ?? `position-${positionId}-brain.zip`;

      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
      toast({ title: "Vault download started", description: filename });
    } catch (err) {
      toast({
        title: "Could not download vault",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  }

  if (query.isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading the brain&hellip;
      </div>
    );
  }

  if (query.isError) {
    const message = query.error instanceof Error ? query.error.message : "Could not load this position's brain.";
    return (
      <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
        <AlertTriangle className="mt-0.5 size-4" />
        <span>{message}</span>
      </div>
    );
  }

  if (!query.data || query.data.totalCount === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/20 p-6 text-center">
        <BookOpen className="mx-auto size-6 text-muted-foreground" />
        <p className="mt-2 text-sm font-medium text-foreground">No durable memory yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Donnit captures memory automatically as tasks are completed for this role.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {query.data.totalCount} memory {query.data.totalCount === 1 ? "row" : "rows"} across {groupedEntries.length} {groupedEntries.length === 1 ? "kind" : "kinds"}.
          Markdown body is canonical; structured fields below are derived.
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleDownload}
          disabled={downloading || query.data.totalCount === 0}
          data-testid="button-brain-export"
        >
          {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          Download Obsidian vault
        </Button>
      </div>

      {groupedEntries.map(([kind, rows]) => (
        <section key={kind} className="space-y-2">
          <header className="flex items-center gap-2">
            <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${KIND_TONES[kind] ?? "bg-muted text-foreground ring-border"}`}>
              {KIND_LABELS[kind] ?? kind}
            </span>
            <span className="text-xs text-muted-foreground">{rows.length}</span>
          </header>

          <div className="space-y-2">
            {rows.map((row) => {
              const conf = confidencePill(row.confidence_score ?? 0);
              const source = SOURCE_LABELS[row.source_kind] ?? row.source_kind;
              return (
                <article key={row.id} className="rounded-md border border-border bg-card p-3 shadow-sm">
                  <header className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <h4 className="text-sm font-semibold text-foreground">{row.title || "(untitled)"}</h4>
                    {row.status !== "active" && (
                      <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {row.status}
                      </span>
                    )}
                  </header>

                  {row.markdown_body ? (
                    <div className="prose prose-sm max-w-none text-foreground">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{row.markdown_body}</ReactMarkdown>
                    </div>
                  ) : row.body ? (
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground">{row.body}</p>
                  ) : (
                    <p className="text-xs italic text-muted-foreground">No body recorded.</p>
                  )}

                  <footer className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 ring-1 ring-inset ${conf.tone}`}>
                      {conf.pct}% confidence
                    </span>
                    <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground">
                      ★ {row.importance}
                    </span>
                    <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground">
                      {source}
                    </span>
                    {row.last_seen_at && (
                      <span className="ml-auto text-muted-foreground">last seen {formatRelative(row.last_seen_at)}</span>
                    )}
                  </footer>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
