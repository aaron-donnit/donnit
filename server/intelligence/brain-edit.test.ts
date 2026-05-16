// Phase 3 D2 — unit tests for DonnitStore.patchPositionProfileKnowledge.
// Exercises the optimistic-locking + snapshot semantics in isolation by
// stubbing the supabase client. The route layer is thin (parse, gate, call,
// shape response) and is exercised by manual verification + the type system.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { DonnitStore } from "../donnit-store";

type AnyFn = (...args: unknown[]) => unknown;
type MockedFn = ReturnType<typeof vi.fn>;

function mockKnowledgeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "knw-1",
    org_id: "org-a",
    position_profile_id: "pos-1",
    kind: "how_to",
    title: "Original title",
    body: "Original body",
    markdown_body: "Original markdown body",
    confidence: "medium",
    confidence_score: 0.6,
    importance: 50,
    status: "active",
    source_kind: "task_event",
    source_task_id: "task-1",
    memory_key: "key-1",
    version: 1,
    last_seen_at: "2026-05-16T18:00:00Z",
    created_at: "2026-05-16T18:00:00Z",
    updated_at: "2026-05-16T18:00:00Z",
    archived_at: null,
    created_by: null,
    ...overrides,
  };
}

/**
 * Build a fake supabase client that DonnitStore can drive. Routes the .from()
 * calls into per-table mocks the test can assert on / override.
 *
 * The store uses postgrest-style builders. For our needs we just need:
 *   - read by id  ->  from(<ppk>).select(...).eq(...).eq(...).maybeSingle()
 *   - update      ->  from(<ppk>).update(...).eq(...).eq(...).eq(...).select(...).maybeSingle()
 *   - snapshot insert -> from(<versions>).insert(...)
 */
function buildClient(opts: {
  initialRow: Record<string, unknown> | null;
  updateBehavior?: "ok" | "stale-no-rows";
  refreshRow?: Record<string, unknown> | null;
  snapshotError?: { message: string } | null;
}) {
  const { initialRow, updateBehavior = "ok", refreshRow, snapshotError = null } = opts;
  const snapshotInserts: unknown[] = [];
  const updatePayloads: unknown[] = [];

  // The read sequence: first call returns initialRow; second (refresh on
  // stale-no-rows) returns refreshRow.
  const readQueue = [initialRow, refreshRow ?? initialRow];

  const makeReadBuilder = () => {
    const builder: Record<string, AnyFn> = {};
    builder.select = vi.fn().mockReturnValue(builder);
    builder.eq = vi.fn().mockReturnValue(builder);
    builder.maybeSingle = vi.fn().mockImplementation(async () => {
      const next = readQueue.shift();
      return { data: next ?? null, error: null };
    });
    return builder;
  };

  const makeUpdateBuilder = () => {
    const builder: Record<string, AnyFn> = {};
    builder.update = vi.fn().mockImplementation((payload: unknown) => {
      updatePayloads.push(payload);
      return builder;
    });
    builder.eq = vi.fn().mockReturnValue(builder);
    builder.select = vi.fn().mockReturnValue(builder);
    builder.maybeSingle = vi.fn().mockImplementation(async () => {
      if (updateBehavior === "stale-no-rows") return { data: null, error: null };
      // ok path: the row returned is the merged state. Construct it from the
      // most recent update payload + the initial row.
      const merged = { ...(initialRow ?? {}), ...(updatePayloads[updatePayloads.length - 1] as Record<string, unknown>) };
      return { data: merged, error: null };
    });
    return builder;
  };

  const makeInsertBuilder = () => ({
    insert: vi.fn().mockImplementation(async (payload: unknown) => {
      snapshotInserts.push(payload);
      return { data: payload, error: snapshotError };
    }),
  });

  const client = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "position_profile_knowledge_versions") return makeInsertBuilder();
      // For position_profile_knowledge: read OR update depending on the
      // first method the caller invokes. The store always reads first then
      // updates, so the call order is deterministic.
      let used = false;
      const dispatcher: Record<string, AnyFn> = {};
      dispatcher.select = vi.fn().mockImplementation((cols: string) => {
        used = true;
        return makeReadBuilder().select(cols);
      });
      dispatcher.update = vi.fn().mockImplementation((payload: unknown) => {
        used = true;
        return makeUpdateBuilder().update(payload);
      });
      void used;
      return dispatcher;
    }),
  };

  return { client, snapshotInserts, updatePayloads };
}

describe("DonnitStore.patchPositionProfileKnowledge", () => {
  let storeWith: (clientFactoryArg: ReturnType<typeof buildClient>) => DonnitStore;

  beforeEach(() => {
    storeWith = (factory) => new DonnitStore(factory.client as unknown as never, "user-actor");
  });

  it("returns not_found when the row doesn't exist", async () => {
    const factory = buildClient({ initialRow: null });
    const store = storeWith(factory);
    const out = await store.patchPositionProfileKnowledge(
      "org-a",
      "knw-missing",
      1,
      { title: "x" },
      "user-actor",
      "edited",
    );
    expect(out.status).toBe("not_found");
  });

  it("returns stale when baseVersion does not match current", async () => {
    const factory = buildClient({ initialRow: mockKnowledgeRow({ version: 3 }) });
    const store = storeWith(factory);
    const out = await store.patchPositionProfileKnowledge(
      "org-a",
      "knw-1",
      1, // client thinks it's v1
      { title: "new" },
      "user-actor",
      "edited",
    );
    if (out.status !== "stale") throw new Error(`expected stale, got ${out.status}`);
    expect(out.current.version).toBe(3);
    expect(factory.snapshotInserts).toHaveLength(0);
  });

  it("returns ok-no-op when patch contains no changed fields", async () => {
    const factory = buildClient({
      initialRow: mockKnowledgeRow({ title: "same" }),
    });
    const store = storeWith(factory);
    const out = await store.patchPositionProfileKnowledge(
      "org-a",
      "knw-1",
      1,
      { title: "same" }, // identical to current
      "user-actor",
      "edited",
    );
    if (out.status !== "ok") throw new Error("expected ok");
    expect(out.changedFields).toEqual([]);
    expect(factory.snapshotInserts).toHaveLength(0); // no snapshot for no-ops
  });

  it("snapshots prior state and bumps version on a real edit", async () => {
    const factory = buildClient({ initialRow: mockKnowledgeRow({ version: 2 }) });
    const store = storeWith(factory);
    const out = await store.patchPositionProfileKnowledge(
      "org-a",
      "knw-1",
      2,
      { title: "Updated title", importance: 80 },
      "user-actor",
      "edited",
    );
    if (out.status !== "ok") throw new Error("expected ok");
    expect(out.changedFields.sort()).toEqual(["importance", "title"]);
    expect(out.priorVersion).toBe(2);
    expect(out.row.version).toBe(3);
    expect(out.row.title).toBe("Updated title");
    expect(out.row.importance).toBe(80);

    // Snapshot was written BEFORE the update with the prior state, version 2.
    expect(factory.snapshotInserts).toHaveLength(1);
    const snap = factory.snapshotInserts[0] as Record<string, unknown>;
    expect(snap.knowledge_id).toBe("knw-1");
    expect(snap.org_id).toBe("org-a");
    expect(snap.version).toBe(2);
    expect(snap.reason).toBe("edited");
    expect((snap.snapshot as Record<string, unknown>).title).toBe("Original title");
    expect((snap.snapshot as Record<string, unknown>).importance).toBe(50);
  });

  it("sets archived_at on status->archived transition", async () => {
    const factory = buildClient({ initialRow: mockKnowledgeRow({ status: "active", archived_at: null }) });
    const store = storeWith(factory);
    const out = await store.patchPositionProfileKnowledge(
      "org-a",
      "knw-1",
      1,
      { status: "archived" },
      "user-actor",
      "archived",
    );
    if (out.status !== "ok") throw new Error("expected ok");
    expect(out.changedFields).toEqual(expect.arrayContaining(["status", "archived_at"]));
    expect(out.row.status).toBe("archived");
    expect(typeof out.row.archived_at).toBe("string");
  });

  it("clears archived_at when restoring active from archived", async () => {
    const factory = buildClient({
      initialRow: mockKnowledgeRow({ status: "archived", archived_at: "2026-05-15T00:00:00Z" }),
    });
    const store = storeWith(factory);
    const out = await store.patchPositionProfileKnowledge(
      "org-a",
      "knw-1",
      1,
      { status: "active" },
      "user-actor",
      "restored",
    );
    if (out.status !== "ok") throw new Error("expected ok");
    expect(out.row.archived_at).toBeNull();
  });

  it("returns stale when the update affects 0 rows (concurrent writer beat us)", async () => {
    const factory = buildClient({
      initialRow: mockKnowledgeRow({ version: 1 }),
      updateBehavior: "stale-no-rows",
      refreshRow: mockKnowledgeRow({ version: 2, title: "Beat you to it" }),
    });
    const store = storeWith(factory);
    const out = await store.patchPositionProfileKnowledge(
      "org-a",
      "knw-1",
      1,
      { title: "Mine" },
      "user-actor",
      "edited",
    );
    if (out.status !== "stale") throw new Error(`expected stale, got ${out.status}`);
    expect(out.current.version).toBe(2);
    expect(out.current.title).toBe("Beat you to it");
  });
});

describe("DonnitStore.archivePositionProfileKnowledge", () => {
  it("is a thin wrapper that sets status to archived", async () => {
    const factory = buildClient({ initialRow: mockKnowledgeRow() });
    const store = new DonnitStore(factory.client as unknown as never, "user-actor");
    const out = await store.archivePositionProfileKnowledge("org-a", "knw-1", 1, "user-actor");
    if (out.status !== "ok") throw new Error("expected ok");
    expect(out.row.status).toBe("archived");
    expect(typeof out.row.archived_at).toBe("string");
  });
});
