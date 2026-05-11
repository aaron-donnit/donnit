import { describe, expect, it, vi } from "vitest";
import type { DonnitStore } from "../donnit-store";
import { draftSuggestionReplyWithAgent } from "./skills/reply-drafter";
import { createHandoverToolRegistry } from "./tools/handover-tools";
import { ToolPermissionError } from "./tool-registry";

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
    getEmailSuggestion: vi.fn(async () => ({
      id: "suggestion-1",
      org_id: "org-1",
      gmail_message_id: "gmail-1",
      gmail_thread_id: "thread-1",
      from_email: "Taylor <taylor@example.com>",
      subject: "Can we schedule time?",
      preview: "Taylor asked for a meeting.",
      body: "Could we schedule 30 minutes next week to review the renewal?",
      received_at: null,
      action_items: ["Schedule renewal meeting"],
      suggested_title: "Schedule renewal meeting",
      suggested_due_date: null,
      urgency: "normal",
      status: "pending",
      assigned_to: null,
      created_at: new Date().toISOString(),
    })),
    ...overrides,
    __modelCalls: modelCalls,
    __toolCalls: toolCalls,
  };
  return store as unknown as DonnitStore & { __modelCalls: unknown[]; __toolCalls: unknown[] };
}

describe("reply drafter skill", () => {
  it("drafts a reply through a typed read tool and logs the session", async () => {
    const store = mockStore();
    const createResponse = vi
      .fn()
      .mockResolvedValueOnce({
        output: [{
          type: "function_call",
          name: "get_email_suggestion_context",
          call_id: "call-1",
          arguments: JSON.stringify({ suggestion_id: "suggestion-1" }),
        }],
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
      })
      .mockResolvedValueOnce({
        output_text: JSON.stringify({
          message: "Hi Taylor,\n\nHappy to find time next week. Please send a few windows that work for you, or share a calendar link and I will grab a slot.\n\nBest,",
          rationale: "The source asks to schedule a meeting, so the draft asks for availability without inventing times.",
        }),
        usage: { input_tokens: 160, output_tokens: 60, total_tokens: 220 },
      });

    const result = await draftSuggestionReplyWithAgent({
      store,
      orgId: "org-1",
      userId: "user-1",
      suggestionId: "suggestion-1",
      sourceFromSuggestion: () => "email",
      replyScenario: () => "scheduling",
      createResponse,
    });

    expect(result.message).toContain("Hi Taylor");
    expect(result.correlationId).toMatch(/^ai_/);
    expect(store.getEmailSuggestion).toHaveBeenCalledWith("suggestion-1");
    expect(store.__modelCalls).toHaveLength(2);
    expect(store.__toolCalls).toHaveLength(1);
    expect(store.updateAiSession).toHaveBeenCalledWith("session-1", expect.objectContaining({ status: "completed" }));
  });

  it("denies write tools without explicit confirmation", async () => {
    const store = mockStore({
      listPositionProfiles: vi.fn(async () => []),
      listTasks: vi.fn(async () => []),
      listEvents: vi.fn(async () => []),
      listOrgMembers: vi.fn(async () => []),
    } as Partial<DonnitStore>);
    const logToolCall = vi.fn();
    const registry = createHandoverToolRegistry({ store, orgId: "org-1" });

    await expect(registry.execute("draft_handover_packet", {
      role_id: "role-1",
      sections: ["open_work"],
      outgoing_user: "user-1",
      idempotency_key: "handover-test-1",
    }, {
      orgId: "org-1",
      userId: "user-1",
      correlationId: "ai-test",
      allowWrites: false,
      observability: { logToolCall },
    })).rejects.toBeInstanceOf(ToolPermissionError);
    expect(logToolCall).toHaveBeenCalledWith(expect.objectContaining({ status: "permission_denied" }));
  });

  it("handles missing suggestion context without inventing source facts", async () => {
    const store = mockStore({ getEmailSuggestion: vi.fn(async () => null) });
    const createResponse = vi
      .fn()
      .mockResolvedValueOnce({
        output: [{
          type: "function_call",
          name: "get_email_suggestion_context",
          call_id: "call-1",
          arguments: JSON.stringify({ suggestion_id: "missing" }),
        }],
        usage: { input_tokens: 60, output_tokens: 15, total_tokens: 75 },
      })
      .mockResolvedValueOnce({
        output_text: JSON.stringify({
          message: "I do not have the original message context. Please reopen the source item or add the sender's request before drafting a reply.",
          rationale: "The tool returned no source content, so the draft avoids inventing a response.",
        }),
        usage: { input_tokens: 90, output_tokens: 30, total_tokens: 120 },
      });

    const result = await draftSuggestionReplyWithAgent({
      store,
      orgId: "org-1",
      userId: "user-1",
      suggestionId: "missing",
      sourceFromSuggestion: () => "email",
      replyScenario: () => "general",
      createResponse,
    });

    expect(result.message).toContain("do not have the original message context");
    expect(store.__toolCalls).toHaveLength(1);
    expect(store.__toolCalls[0]).toEqual(expect.objectContaining({ status: "success" }));
  });
});
