import { describe, expect, it, vi, beforeEach } from "vitest";
import { z } from "zod";
import {
  estimateAnthropicCost,
  extractAnthropicText,
  runAnthropicToolLoop,
  type AnthropicResponse,
} from "./anthropic-agent";

// Minimal stub of ToolRegistry surface used by runAnthropicToolLoop.
function makeRegistry(tools: Array<{ name: string; description: string; inputJsonSchema: Record<string, unknown> }>) {
  return {
    toOpenAiTools(names?: string[]) {
      const allowed = names ? new Set(names) : null;
      return tools
        .filter((t) => !allowed || allowed.has(t.name))
        .map((t) => ({
          type: "function" as const,
          name: t.name,
          description: t.description,
          strict: true,
          parameters: t.inputJsonSchema,
        }));
    },
    async execute(name: string, input: Record<string, unknown>) {
      return { ok: true, tool: name, input };
    },
  } as any;
}

function makeObservability() {
  return {
    correlationId: "corr-test",
    session: { org_id: "org-a", user_id: "user-a" },
    logModelCall: vi.fn().mockResolvedValue(undefined),
    logToolCall: vi.fn().mockResolvedValue(undefined),
  } as any;
}

describe("estimateAnthropicCost", () => {
  it("returns 0 when usage or model is unknown", () => {
    expect(estimateAnthropicCost("nonexistent-model", { input_tokens: 100, output_tokens: 50 })).toBe(0);
    expect(estimateAnthropicCost("claude-sonnet-4-6", undefined)).toBe(0);
  });

  it("computes pricing for sonnet correctly", () => {
    const cost = estimateAnthropicCost("claude-sonnet-4-6", {
      input_tokens: 1_000_000,
      output_tokens: 100_000,
      cache_read_input_tokens: 0,
    });
    // 1M input * $3 + 100k output * $15 = $3 + $1.5 = $4.5
    expect(cost).toBeCloseTo(4.5, 2);
  });

  it("discounts cached input tokens", () => {
    const cost = estimateAnthropicCost("claude-sonnet-4-6", {
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_read_input_tokens: 1_000_000,
    });
    // All input was cached: 1M * $0.30 = $0.30
    expect(cost).toBeCloseTo(0.3, 2);
  });
});

describe("extractAnthropicText", () => {
  it("returns the first text content block", () => {
    const r: AnthropicResponse = { content: [{ type: "text", text: "hello world" }] };
    expect(extractAnthropicText(r)).toBe("hello world");
  });

  it("skips non-text blocks", () => {
    const r: AnthropicResponse = {
      content: [
        { type: "tool_use", name: "foo", id: "t1", input: {} },
        { type: "text", text: "the answer" },
      ],
    };
    expect(extractAnthropicText(r)).toBe("the answer");
  });

  it("returns null when no text block exists", () => {
    const r: AnthropicResponse = { content: [{ type: "tool_use", name: "foo", id: "t1", input: {} }] };
    expect(extractAnthropicText(r)).toBeNull();
  });
});

describe("runAnthropicToolLoop", () => {
  const outputSchema = z.object({ result: z.string() });
  const outputJsonSchema = { type: "object", properties: { result: { type: "string" } }, required: ["result"] };

  let messagesCreate: ReturnType<typeof vi.fn>;
  let client: { messages: { create: typeof messagesCreate } };

  beforeEach(() => {
    messagesCreate = vi.fn();
    client = { messages: { create: messagesCreate } } as any;
  });

  it("returns parsed output when the model responds with valid JSON and no tool calls", async () => {
    messagesCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: '{"result":"done"}' }],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 20 },
    });

    const result = await runAnthropicToolLoop({
      skillId: "test-skill",
      model: "claude-sonnet-4-6",
      instructions: "Be brief.",
      messages: [{ role: "user", content: "hi" }],
      registry: makeRegistry([]),
      toolNames: [],
      outputSchema,
      outputJsonSchema,
      observability: makeObservability(),
      client: client as any,
    });

    expect(result).toEqual({ result: "done" });
    expect(messagesCreate).toHaveBeenCalledOnce();
    const callArgs = messagesCreate.mock.calls[0]![0];
    expect(callArgs.model).toBe("claude-sonnet-4-6");
    expect(callArgs.messages[0]).toEqual({ role: "user", content: "hi" });
  });

  it("strips ``` fences when the model wraps JSON despite instructions", async () => {
    messagesCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: '```json\n{"result":"wrapped"}\n```' }],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 20 },
    });

    const result = await runAnthropicToolLoop({
      skillId: "test-skill",
      model: "claude-sonnet-4-6",
      instructions: "be brief",
      messages: [{ role: "user", content: "hi" }],
      registry: makeRegistry([]),
      toolNames: [],
      outputSchema,
      outputJsonSchema,
      observability: makeObservability(),
      client: client as any,
    });

    expect(result).toEqual({ result: "wrapped" });
  });

  it("executes a tool call and continues the loop", async () => {
    messagesCreate
      .mockResolvedValueOnce({
        content: [{ type: "tool_use", id: "t1", name: "lookup", input: { q: "x" } }],
        stop_reason: "tool_use",
        usage: { input_tokens: 100, output_tokens: 20 },
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: '{"result":"after-tool"}' }],
        stop_reason: "end_turn",
        usage: { input_tokens: 120, output_tokens: 25 },
      });

    const registry = makeRegistry([
      { name: "lookup", description: "Lookup something", inputJsonSchema: { type: "object", properties: { q: { type: "string" } } } },
    ]);

    const result = await runAnthropicToolLoop({
      skillId: "test-skill",
      model: "claude-sonnet-4-6",
      instructions: "be brief",
      messages: [{ role: "user", content: "look up x" }],
      registry,
      toolNames: ["lookup"],
      outputSchema,
      outputJsonSchema,
      observability: makeObservability(),
      client: client as any,
      maxToolSteps: 3,
    });

    expect(result).toEqual({ result: "after-tool" });
    expect(messagesCreate).toHaveBeenCalledTimes(2);

    // Second call should include the tool_result in the conversation.
    const secondCallMessages = messagesCreate.mock.calls[1]![0].messages;
    const toolResultMessage = secondCallMessages.find((m: any) =>
      Array.isArray(m.content) && m.content.some((c: any) => c.type === "tool_result"),
    );
    expect(toolResultMessage).toBeDefined();
  });

  it("throws when tool steps exceed the cap", async () => {
    messagesCreate.mockResolvedValue({
      content: [{ type: "tool_use", id: "t1", name: "lookup", input: {} }],
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const registry = makeRegistry([
      { name: "lookup", description: "Lookup something", inputJsonSchema: { type: "object" } },
    ]);

    await expect(
      runAnthropicToolLoop({
        skillId: "test-skill",
        model: "claude-sonnet-4-6",
        instructions: "be brief",
        messages: [{ role: "user", content: "loop forever" }],
        registry,
        toolNames: ["lookup"],
        outputSchema,
        outputJsonSchema,
        observability: makeObservability(),
        client: client as any,
        maxToolSteps: 1,
      }),
    ).rejects.toThrow(/tool step limit/);
  });

  it("logs a failed model call when the SDK throws", async () => {
    messagesCreate.mockRejectedValueOnce(Object.assign(new Error("auth fail"), { status: 401 }));
    const observability = makeObservability();

    await expect(
      runAnthropicToolLoop({
        skillId: "test-skill",
        model: "claude-sonnet-4-6",
        instructions: "be brief",
        messages: [{ role: "user", content: "hi" }],
        registry: makeRegistry([]),
        toolNames: [],
        outputSchema,
        outputJsonSchema,
        observability,
        client: client as any,
      }),
    ).rejects.toThrow(/Anthropic authentication failed/);

    expect(observability.logModelCall).toHaveBeenCalled();
    const args = observability.logModelCall.mock.calls[0][0];
    expect(args.status).toBe("failed");
    expect(args.errorMessage).toMatch(/auth fail/);
  });
});
