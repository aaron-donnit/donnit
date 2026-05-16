import { describe, expect, it, vi, beforeEach } from "vitest";
import type { DonnitStore } from "../donnit-store";
import { captureUserWisdomFromCompletion } from "./completion-memory";

function makeStore() {
  return {
    upsertPositionProfileKnowledge: vi.fn().mockResolvedValue({
      id: "knw-1",
      org_id: "org-a",
      position_profile_id: "pos-1",
      kind: "how_to",
      title: "test",
      memory_key: "task-completion-wisdom:task-1",
    }),
    createLearningEvent: vi.fn().mockResolvedValue({ id: "lev-1" }),
  } as unknown as DonnitStore;
}

const baseInput = {
  orgId: "org-a",
  taskId: "task-1",
  positionProfileId: "pos-1",
  actorId: "user-1",
  taskTitle: "Run the monthly close",
  memoryNote: "Watch out for the timezone bug on the export — always pass UTC.",
} as const;

describe("captureUserWisdomFromCompletion", () => {
  let store: ReturnType<typeof makeStore>;

  beforeEach(() => {
    store = makeStore();
  });

  it("returns null when memoryNote is empty", async () => {
    const out = await captureUserWisdomFromCompletion({ ...baseInput, memoryNote: "", store });
    expect(out).toBeNull();
    expect(store.upsertPositionProfileKnowledge).not.toHaveBeenCalled();
    expect(store.createLearningEvent).not.toHaveBeenCalled();
  });

  it("returns null when memoryNote is whitespace only", async () => {
    const out = await captureUserWisdomFromCompletion({ ...baseInput, memoryNote: "   \n  \t  ", store });
    expect(out).toBeNull();
    expect(store.upsertPositionProfileKnowledge).not.toHaveBeenCalled();
    expect(store.createLearningEvent).not.toHaveBeenCalled();
  });

  it("returns null when positionProfileId is missing", async () => {
    const out = await captureUserWisdomFromCompletion({ ...baseInput, positionProfileId: "", store });
    expect(out).toBeNull();
    expect(store.upsertPositionProfileKnowledge).not.toHaveBeenCalled();
  });

  it("returns null for personal-visibility tasks", async () => {
    const out = await captureUserWisdomFromCompletion({ ...baseInput, visibility: "personal", store });
    expect(out).toBeNull();
    expect(store.upsertPositionProfileKnowledge).not.toHaveBeenCalled();
  });

  it("inserts a how_to row with the right shape when the note is provided", async () => {
    const out = await captureUserWisdomFromCompletion({ ...baseInput, store });
    expect(out).not.toBeNull();
    expect(store.upsertPositionProfileKnowledge).toHaveBeenCalledOnce();
    const args = (store.upsertPositionProfileKnowledge as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(args[0]).toBe("org-a");
    expect(args[1]).toMatchObject({
      position_profile_id: "pos-1",
      source_task_id: "task-1",
      kind: "how_to",
      title: "Run the monthly close",
      source_kind: "task_event",
      confidence_score: 0.7,
      importance: 60,
      status: "active",
    });
    expect((args[1] as { markdown_body: string }).markdown_body).toContain("# Run the monthly close");
    expect((args[1] as { markdown_body: string }).markdown_body).toContain("timezone bug");
    expect((args[1] as { memory_key: string }).memory_key).toMatch(/^task-completion-wisdom:/);
  });

  it("inserts a learning_events audit row", async () => {
    await captureUserWisdomFromCompletion({ ...baseInput, store });
    expect(store.createLearningEvent).toHaveBeenCalledOnce();
    const args = (store.createLearningEvent as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(args[0]).toBe("org-a");
    expect(args[1]).toMatchObject({
      source: "manual",
      event_type: "task_completion_memory_captured",
      scope_type: "position_profile",
      scope_id: "pos-1",
      position_profile_id: "pos-1",
      task_id: "task-1",
      confidence_score: 0.7,
    });
    expect((args[1] as { raw_text: string }).raw_text).toContain("timezone bug");
  });

  it("trims surrounding whitespace from the note before storing", async () => {
    await captureUserWisdomFromCompletion({
      ...baseInput,
      memoryNote: "   \n  Pay attention to UTC.  \n",
      store,
    });
    const args = (store.upsertPositionProfileKnowledge as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect((args[1] as { body: string }).body).toBe("Pay attention to UTC.");
  });

  it("falls back to a generic title when taskTitle is empty", async () => {
    await captureUserWisdomFromCompletion({ ...baseInput, taskTitle: "", store });
    const args = (store.upsertPositionProfileKnowledge as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect((args[1] as { title: string }).title).toBe("Task wisdom");
  });
});
