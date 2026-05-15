import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  DONNIT_FALLBACK_AI_MODEL,
  OpenAiModelNotFoundError,
  runOpenAiToolLoop,
  type OpenAiResponse,
} from "./openai-agent";
import { ToolRegistry } from "./tool-registry";

// Pins the model-not-found fallback: when DONNIT_AI_MODEL is misconfigured
// or has been retired, parsing must not fail hard for every chat/email/Slack
// message. We retry once with a known-good model from the price table.

function buildObservability() {
  const calls: Array<{ model: string; status: string }> = [];
  return {
    calls,
    correlationId: "test-corr",
    session: { org_id: "org-1", user_id: "user-1" },
    logModelCall: vi.fn(async (input: { model: string; status: string }) => {
      calls.push({ model: input.model, status: input.status });
    }),
    logToolCall: vi.fn(async () => {}),
  };
}

function buildSchema() {
  const schema = z.object({ answer: z.string() });
  const jsonSchema: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    properties: { answer: { type: "string" } },
    required: ["answer"],
  };
  return { schema, jsonSchema };
}

function successResponse(text: string): OpenAiResponse {
  return {
    output_text: text,
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  };
}

describe("runOpenAiToolLoop model fallback", () => {
  it("retries with the fallback model when the configured model is not found", async () => {
    const observability = buildObservability();
    const { schema, jsonSchema } = buildSchema();
    const seenModels: string[] = [];
    const createResponse = vi.fn(async (payload: { model: string }) => {
      seenModels.push(payload.model);
      if (payload.model === "gpt-imaginary") {
        throw new OpenAiModelNotFoundError("gpt-imaginary", "The model `gpt-imaginary` does not exist");
      }
      return successResponse(JSON.stringify({ answer: "ok" }));
    });

    const result = await runOpenAiToolLoop({
      skillId: "test_skill",
      model: "gpt-imaginary",
      instructions: "answer the user",
      messages: [{ role: "user", content: "say ok" }],
      registry: new ToolRegistry(),
      toolNames: [],
      outputSchema: schema,
      outputJsonSchema: jsonSchema,
      observability: observability as never,
      createResponse: createResponse as never,
    });

    expect(result).toEqual({ answer: "ok" });
    expect(seenModels).toEqual(["gpt-imaginary", DONNIT_FALLBACK_AI_MODEL]);
    expect(observability.calls.find((entry) => entry.model === DONNIT_FALLBACK_AI_MODEL)?.status).toBe("success");
    expect(observability.calls.find((entry) => entry.model === "gpt-imaginary")?.status).toBe("failed");
  });

  it("does not retry when the failure is not a model-not-found error", async () => {
    const observability = buildObservability();
    const { schema, jsonSchema } = buildSchema();
    const createResponse = vi.fn(async () => {
      throw new Error("rate limit");
    });

    await expect(
      runOpenAiToolLoop({
        skillId: "test_skill",
        model: "gpt-imaginary",
        instructions: "answer the user",
        messages: [{ role: "user", content: "say ok" }],
        registry: new ToolRegistry(),
        toolNames: [],
        outputSchema: schema,
        outputJsonSchema: jsonSchema,
        observability: observability as never,
        createResponse: createResponse as never,
      }),
    ).rejects.toThrow("rate limit");

    expect(createResponse).toHaveBeenCalledTimes(1);
  });

  it("does not retry a second time if the fallback model also fails", async () => {
    const observability = buildObservability();
    const { schema, jsonSchema } = buildSchema();
    const createResponse = vi.fn(async (payload: { model: string }) => {
      throw new OpenAiModelNotFoundError(payload.model, "missing");
    });

    await expect(
      runOpenAiToolLoop({
        skillId: "test_skill",
        model: "gpt-imaginary",
        instructions: "answer the user",
        messages: [{ role: "user", content: "say ok" }],
        registry: new ToolRegistry(),
        toolNames: [],
        outputSchema: schema,
        outputJsonSchema: jsonSchema,
        observability: observability as never,
        createResponse: createResponse as never,
      }),
    ).rejects.toBeInstanceOf(OpenAiModelNotFoundError);

    // First call to original model, then one fallback retry. No third call.
    expect(createResponse).toHaveBeenCalledTimes(2);
  });
});
