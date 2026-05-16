import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle, Archive, BookOpen, Download, Loader2, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  // Phase 3 D1 — optimistic-locking counter. Server returns 1 for rows that
  // pre-date the migration; client always carries it in the edit payload.
  version?: number;
};

// Phase 3 D3 — kinds editable from the UI. Source of truth is
// positionKnowledgeKindEnum in shared/schema.ts; mirrored here as labels.
const EDITABLE_KINDS: Array<{ value: string; label: string }> = [
  { value: "handoff_note", label: "Handoff note" },
  { value: "decision_rule", label: "Decision rule" },
  { value: "recurring_responsibility", label: "Recurring responsibility" },
  { value: "process", label: "Process" },
  { value: "how_to", label: "How-to" },
  { value: "relationship", label: "Relationship" },
  { value: "stakeholder", label: "Stakeholder" },
  { value: "tool", label: "Tool" },
  { value: "preference", label: "Preference" },
  { value: "risk", label: "Risk" },
  { value: "critical_date", label: "Critical date" },
  { value: "historical_note", label: "Historical note" },
];

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
  const [editingRow, setEditingRow] = useState<BrainKnowledgeRow | null>(null);
  const [archivingRow, setArchivingRow] = useState<BrainKnowledgeRow | null>(null);
  const queryClient = useQueryClient();

  const query = useQuery<BrainResponse>({
    queryKey: ["position-brain", String(positionId)],
    enabled: enabled && Boolean(positionId),
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/positions/${positionId}/brain`);
      return (await res.json()) as BrainResponse;
    },
  });

  function refreshBrain() {
    queryClient.invalidateQueries({ queryKey: ["position-brain", String(positionId)] });
  }

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
                    <div className="ml-auto flex gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={() => setEditingRow(row)}
                        title="Edit this memory row"
                        aria-label="Edit"
                        data-testid={`button-brain-edit-${row.id}`}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={() => setArchivingRow(row)}
                        title="Archive this memory row"
                        aria-label="Archive"
                        data-testid={`button-brain-archive-${row.id}`}
                      >
                        <Archive className="size-3.5" />
                      </Button>
                    </div>
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

      <EditMemoryDialog
        row={editingRow}
        positionId={String(positionId)}
        onClose={() => setEditingRow(null)}
        onSaved={() => {
          setEditingRow(null);
          refreshBrain();
        }}
      />

      <ArchiveMemoryDialog
        row={archivingRow}
        positionId={String(positionId)}
        onClose={() => setArchivingRow(null)}
        onArchived={() => {
          setArchivingRow(null);
          refreshBrain();
        }}
      />
    </div>
  );
}

// Phase 3 D3 — edit dialog. Carries the row's version as baseVersion in
// every save; on 409 the server returns conflict + current row and we
// surface a toast that nudges the admin to refresh.
function EditMemoryDialog(props: {
  row: BrainKnowledgeRow | null;
  positionId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { row, positionId, onClose, onSaved } = props;
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("");
  const [importance, setImportance] = useState(50);
  const [markdownBody, setMarkdownBody] = useState("");

  useEffect(() => {
    if (!row) return;
    setTitle(row.title ?? "");
    setKind(row.kind ?? "how_to");
    setImportance(typeof row.importance === "number" ? row.importance : 50);
    setMarkdownBody(row.markdown_body ?? row.body ?? "");
  }, [row]);

  const save = useMutation({
    mutationFn: async () => {
      if (!row) throw new Error("No row selected.");
      const baseVersion = row.version ?? 1;
      const res = await apiRequest("PATCH", `/api/positions/${positionId}/brain/${row.id}`, {
        baseVersion,
        title,
        markdownBody,
        body: markdownBody,
        kind,
        importance,
      });
      return res;
    },
    onSuccess: () => {
      toast({ title: "Memory row saved", description: title.slice(0, 100) });
      onSaved();
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      // apiRequest serializes the status code into the error message via
      // throwIfResNotOk; detect the 409 case so we can prompt a refresh.
      if (message.startsWith("409")) {
        toast({
          title: "This row changed elsewhere",
          description: "Someone else saved an edit while you were typing. Refreshing the Brain tab.",
          variant: "destructive",
        });
        queryClient.invalidateQueries({ queryKey: ["position-brain", positionId] });
        onClose();
        return;
      }
      toast({
        title: "Could not save",
        description: message,
        variant: "destructive",
      });
    },
  });

  const open = Boolean(row);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit memory row</DialogTitle>
          <DialogDescription>
            Changes are versioned. Every save snapshots the prior state.
            Version <span className="font-mono">{row?.version ?? 1}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="brain-edit-title">Title</Label>
            <Input
              id="brain-edit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              data-testid="input-brain-edit-title"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="brain-edit-kind">Kind</Label>
              <select
                id="brain-edit-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                data-testid="select-brain-edit-kind"
              >
                {EDITABLE_KINDS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="brain-edit-importance">Importance <span className="font-mono text-xs text-muted-foreground">{importance}</span></Label>
              <input
                id="brain-edit-importance"
                type="range"
                min={0}
                max={100}
                step={1}
                value={importance}
                onChange={(e) => setImportance(Number(e.target.value))}
                className="w-full"
                data-testid="input-brain-edit-importance"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="brain-edit-body">Markdown body</Label>
            <Textarea
              id="brain-edit-body"
              value={markdownBody}
              onChange={(e) => setMarkdownBody(e.target.value)}
              maxLength={50000}
              rows={10}
              className="font-mono text-xs"
              placeholder="# Headings, **bold**, lists, etc. Rendered in the Brain tab."
              data-testid="textarea-brain-edit-body"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>
            <X className="size-4" />
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending || !title.trim()}
            data-testid="button-brain-edit-save"
          >
            {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Pencil className="size-4" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Phase 3 D3 — archive confirmation dialog. Soft-deletes the row by setting
// status='archived' and archived_at; the row stays in the version history
// for audit and disappears from the default Brain tab view.
function ArchiveMemoryDialog(props: {
  row: BrainKnowledgeRow | null;
  positionId: string;
  onClose: () => void;
  onArchived: () => void;
}) {
  const { row, positionId, onClose, onArchived } = props;
  const queryClient = useQueryClient();

  const archive = useMutation({
    mutationFn: async () => {
      if (!row) throw new Error("No row selected.");
      const baseVersion = row.version ?? 1;
      await apiRequest("POST", `/api/positions/${positionId}/brain/${row.id}/archive`, { baseVersion });
    },
    onSuccess: () => {
      toast({ title: "Archived", description: row?.title ?? "Memory row archived." });
      onArchived();
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith("409")) {
        toast({
          title: "This row changed elsewhere",
          description: "Refreshing the Brain tab before archiving.",
          variant: "destructive",
        });
        queryClient.invalidateQueries({ queryKey: ["position-brain", positionId] });
        onClose();
        return;
      }
      toast({ title: "Could not archive", description: message, variant: "destructive" });
    },
  });

  const open = Boolean(row);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Archive this memory row?</DialogTitle>
          <DialogDescription>
            It won&apos;t appear in the Brain tab anymore. The full version history stays so you can audit or restore later.
          </DialogDescription>
        </DialogHeader>

        <p className="rounded-md bg-muted/40 px-3 py-2 text-sm font-medium text-foreground">
          {row?.title || "(untitled)"}
        </p>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={archive.isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => archive.mutate()}
            disabled={archive.isPending}
            data-testid="button-brain-archive-confirm"
          >
            {archive.isPending ? <Loader2 className="size-4 animate-spin" /> : <Archive className="size-4" />}
            Archive
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
