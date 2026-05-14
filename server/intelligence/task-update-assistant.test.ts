import { describe, expect, it, vi } from "vitest";
import type { DonnitStore } from "../donnit-store";
import { draftTaskUpdateWithAgent } from "./skills/task-update-assistant";

function mockStore(overrides: Partial<DonnitStore> = {}) {
  const modelCalls: unknown[] = [];
  const toolCalls: unknown[] = [];
  const store = {
    userId: "user-1",
    createAiSession: vi.fn(async (_orgId, input) => ({
      id: "session-1",
      org_id: "org-1",
      user_id: "user-1",
      status: "started",
      estimated_cost_usd: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: null,
      ...input,
    })),
    updateAiSession: vi.fn(async () => null),
    createAiModelCall: vi.fn(async (input) => {
      modelCalls.push(input);
    }),
    createAiToolCall: vi.fn(async (input) => {
      toolCalls.push(input);
    }),
    getTask: vi.fn(async () => ({
      id: "task-1",
      org_id: "org-1",
      title: "Prepare payroll report",
      description: "Nina needs the payroll update summarized before Friday.",
      status: "accepted",
      urgency: "high",
      due_date: "2026-05-15",
      due_time: null,
      start_time: null,
      end_time: null,
      is_all_day: false,
      estimated_minutes: 45,
      assigned_to: "user-2",
      assigned_by: "user-1",
      delegated_to: null,
      collaborator_ids: [],
      source: "chat",
      recurrence: "none",
      reminder_days_before: 0,
      position_profile_id: "role-1",
      visibility: "work",
      visible_from: null,
      accepted_at: null,
      denied_at: null,
      completed_at: null,
      completion_notes: "Waiting on final hours file.",
      created_at: "2026-05-13T12:00:00.000Z",
    })),
    listTaskSubtasks: vi.fn(async () => [
      {
        id: "subtask-1",
        task_id: "task-1",
        org_id: "org-1",
        title: "Pull payroll hours",
        status: "open",
        position: 0,
        completed_at: null,
        created_at: "2026-05-13T12:01:00.000Z",
      },
    ]),
    listEvents: vi.fn(async () => [
      {
        id: "event-1",
        org_id: "org-1",
        task_id: "task-1",
        actor_id: "user-2",
        type: "note_added",
        note: "Nina asked for the missing hours file.",
        created_at: "2026-05-13T13:00:00.000Z",
      },
    ]),
    listPositionProfiles: vi.fn(async () => [
      {
        id: "role-1",
        org_id: "org-1",
        title: "Finance Coordinator",
        status: "active",
        current_owner_id: "user-2",
        direct_manager_id: "user-1",
        temporary_owner_id: null,
        delegate_user_id: null,
        delegate_until: null,
        auto_update_rules: {},
        institutional_memory: { payroll: "Payroll reports depend on the final hours file from managers." },
        risk_score: 35,
        risk_summary: "Payroll timing is the primary continuity risk.",
        created_at: "2026-05-01T00:00:00.000Z",
        updated_at: "2026-05-13T00:00:00.000Z",
      },
    ]),
    listPositionProfileKnowledge: vi.fn(async () => [
      {
        id: "knowledge-1",
        org_id: "org-1",
        position_profile_id: "role-1",
        source_task_id: "task-1",
        kind: "how_to",
        title: "Prepare payroll report",
        body: "Payroll reports require the final hours file before they can be completed.",
        confidence: "high",
        last_seen_at: "2026-05-13T13:00:00.000Z",
        created_at: "2026-05-13T13:00:00.000Z",
        memory_key: "task:task-1:how-to",
        markdown_body: "# How to: Prepare payroll report\n\nUse the final hours file before completing payroll.",
        source_kind: "task_event",
        status: "active",
        importance: 84,
        confidence_score: 0.86,
      },
    ]),
    ...overrides,
    __modelCalls: modelCalls,
    __toolCalls: toolCalls,
  };
  return store as unknown as DonnitStore & { __modelCalls: unknown[]; __toolCalls: unknown[] };
}

describe("task update assistant skill", () => {
  it("reads task context through a typed tool and produces a bounded report", async () => {
    const store = mockStore();
    const createResponse = vi
      .fn()
      .mockResolvedValueOnce({
        output: [{
          type: "function_call",
          name: "get_task_context",
          call_id: "call-1",
          arguments: JSON.stringify({ task_id: "task-1" }),
        }],
        usage: { input_tokens: 120, output_tokens: 20, total_tokens: 140 },
      })
      .mockResolvedValueOnce({
        output_text: JSON.stringify({
          summary: "The payroll report is accepted but blocked on the final hours file.",
          suggested_update: "Payroll report is in progress. Nina is waiting on the final hours file before she can finish the report by Friday.",
          blockers: ["Final hours file is missing."],
          suggested_next_steps: ["Request the final hours file from managers.", "Attach the file to the task once received."],
          profile_memory_candidate: "Payroll reports depend on receiving final hours files from managers before the report can be completed.",
          confidence: "high",
        }),
        usage: { input_tokens: 220, output_tokens: 90, total_tokens: 310 },
      });

    const result = await draftTaskUpdateWithAgent({
      store,
      orgId: "org-1",
      userId: "user-1",
      taskId: "task-1",
      instruction: "Check what is blocking this task and report back.",
      createResponse,
    });

    expect(result.summary).toContain("blocked");
    expect(result.profile_memory_candidate).toContain("Payroll reports");
    expect(store.getTask).toHaveBeenCalledWith("task-1");
    expect(store.listPositionProfileKnowledge).toHaveBeenCalledWith("org-1", "role-1");
    expect(store.__modelCalls).toHaveLength(2);
    expect(store.__toolCalls).toHaveLength(1);
    expect(store.updateAiSession).toHaveBeenCalledWith("session-1", expect.objectContaining({ status: "completed" }));
  });
});
