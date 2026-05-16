import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { AiObservability } from "./observability";
import type { ToolRegistry } from "./tool-registry";

// Mirrors the export shape of openai-agent.ts so callers can pick a provider
// without restructuring their code. Donnit's existing skills route through
// OpenAI by default; this module is callable when getDonnitModelPolicy
// (or an explicit caller) selects "anthropic" as the provider.

export type AnthropicUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

export type AnthropicResponse = {
  content?: Array<{
    type: string;
    text?: string;
    name?: string;
    id?: string;
    input?: unknown;
  }>;
  stop_reason?: string;
  usage?: AnthropicUsage;
  [key: string]: unknown;
};

// Per-1M-token pricing in USD. Keep in sync with Anthropic's published rates.
const MODEL_PRICES_PER_1M: Record<string, { input: number; cachedInput: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3, cachedInput: 0.3, output: 15 },
  "claude-opus-4-7": { input: 15, cachedInput: 1.5, output: 75 },
  "claude-haiku-4-5": { input: 0.8, cachedInput: 0.08, output: 4 },
};

export function estimateAnthropicCost(model: string, usage: AnthropicUsage | undefined): number {
  const pricing = MODEL_PRICES_PER_1M[model];
  if (!pricing || !usage) return 0;
  const input = usage.input_tokens ?? 0;
  const cachedRead = usage.cache_read_input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const uncachedInput = Math.max(input - cachedRead, 0);
  return (
    (uncachedInput * pricing.input) +
    (cachedRead * pricing.cachedInput) +
    (output * pricing.output)
  ) / 1_000_000;
}

export function extractAnthropicText(response: AnthropicResponse): string | null {
  const parts = response.content ?? [];
  for (const part of parts) {
    if (part.type === "text" && typeof part.text === "string") return part.text;
  }
  return null;
}

function anthropicOperatorMessage(status: number, body: string): string {
  const lower = body.toLowerCase();
  if (status === 401) {
    return "Anthropic authentication failed. Confirm DONNIT_ANTHROPIC_API_KEY is set in this environment.";
  }
  if (status === 403) {
    return "Anthropic rejected the request. Confirm the API key's organization has access to the configured Claude model.";
  }
  if (status === 404 && lower.includes("model")) {
    return "Anthropic could not find the configured model. Check DONNIT_ANTHROPIC_MODEL / DONNIT_ANTHROPIC_REASONING_MODEL.";
  }
  if (status === 429) {
    return "Anthropic rate limit or quota was reached. Check organization usage in the Anthropic Console.";
  }
  return `Anthropic response failed with status ${status}.`;
}

// Function-call collection — Anthropic surfaces tool use as content blocks
// with type === "tool_use". This is the equivalent of OpenAI's function_call.
type AnthropicToolUse = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};

function toolUseBlocks(response: AnthropicResponse): AnthropicToolUse[] {
  const out: AnthropicToolUse[] = [];
  for (const part of response.content ?? []) {
    if (part.type === "tool_use" && typeof part.name === "string" && typeof part.id === "string") {
      out.push({
        type: "tool_use",
        id: part.id,
        name: part.name,
        input: (part.input as Record<string, unknown>) ?? {},
      });
    }
  }
  return out;
}

export type AnthropicClient = Pick<Anthropic, "messages">;

export function getAnthropicClient(): AnthropicClient {
  const apiKey = process.env.DONNIT_ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("DONNIT_ANTHROPIC_API_KEY is not set. Add it to .env.local before routing to Anthropic.");
  }
  return new Anthropic({ apiKey });
}

export async function runAnthropicToolLoop<T>(input: {
  skillId: string;
  model: string;
  instructions: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  registry: ToolRegistry;
  toolNames: string[];
  outputSchema: z.ZodType<T>;
  outputJsonSchema: Record<string, unknown>;
  observability: AiObservability;
  allowWrites?: boolean;
  maxToolSteps?: number;
  timeoutMs?: number;
  client?: AnthropicClient;
}): Promise<T> {
  const client = input.client ?? getAnthropicClient();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 12000);

  // Anthropic doesn't have a first-class structured-output JSON-schema mode the
  // way OpenAI Responses do. We get the same effect by:
  //   (1) instructing the model to return ONLY JSON matching the schema, and
  //   (2) validating with Zod after extraction.
  const systemInstructions =
    `${input.instructions}\n\nReturn ONLY a single JSON object that conforms to this schema. Do not wrap it in markdown fences:\n` +
    JSON.stringify(input.outputJsonSchema);

  // Donnit's ToolRegistry currently exposes only toOpenAiTools. The OpenAI
  // Responses-API tool format here is { type, name, description, strict,
  // parameters: <JSON schema> }. We re-shape it for Anthropic's Messages-API
  // tool format: { name, description, input_schema: <JSON schema> }.
  const tools = input.registry.toOpenAiTools(input.toolNames).map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: (t.parameters ?? { type: "object" }) as Record<string, unknown>,
  }));

  const conversation: Array<{ role: "user" | "assistant"; content: any }> = [
    ...input.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  let lastResponse: AnthropicResponse | null = null;
  let totalToolSteps = 0;

  try {
    while (true) {
      const started = Date.now();
      const payload: Anthropic.MessageCreateParamsNonStreaming = {
        model: input.model,
        system: systemInstructions,
        max_tokens: 4096,
        messages: conversation as Anthropic.MessageParam[],
        ...(tools.length ? { tools: tools as Anthropic.Tool[] } : {}),
      };
      const loggablePayload = payload as unknown as Record<string, unknown>;

      try {
        lastResponse = (await client.messages.create(payload, { signal: controller.signal })) as unknown as AnthropicResponse;
        await input.observability.logModelCall({
          skillId: input.skillId,
          model: input.model,
          requestPayload: loggablePayload,
          responsePayload: lastResponse as Record<string, unknown>,
          latencyMs: Date.now() - started,
          inputTokens: lastResponse.usage?.input_tokens ?? 0,
          outputTokens: lastResponse.usage?.output_tokens ?? 0,
          cachedInputTokens: lastResponse.usage?.cache_read_input_tokens ?? 0,
          totalTokens: (lastResponse.usage?.input_tokens ?? 0) + (lastResponse.usage?.output_tokens ?? 0),
          estimatedCostUsd: estimateAnthropicCost(input.model, lastResponse.usage),
          status: "success",
        });
      } catch (error) {
        const status = (error as { status?: number })?.status ?? 0;
        const message = error instanceof Error ? error.message : String(error);
        await input.observability.logModelCall({
          skillId: input.skillId,
          model: input.model,
          requestPayload: loggablePayload,
          responsePayload: {},
          latencyMs: Date.now() - started,
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          totalTokens: 0,
          estimatedCostUsd: 0,
          status: "failed",
          errorMessage: message,
        });
        if (status >= 400) throw new Error(anthropicOperatorMessage(status, message));
        throw error;
      }

      const calls = toolUseBlocks(lastResponse);
      if (calls.length === 0) break;
      totalToolSteps += calls.length;
      if (totalToolSteps > (input.maxToolSteps ?? 3)) throw new Error("AI tool step limit exceeded.");

      conversation.push({ role: "assistant", content: lastResponse.content ?? [] });

      const toolResults: any[] = [];
      for (const call of calls) {
        const output = await input.registry.execute(call.name, call.input, {
          orgId: input.observability.session.org_id,
          userId: input.observability.session.user_id ?? "",
          correlationId: input.observability.correlationId,
          allowWrites: input.allowWrites ?? false,
          observability: input.observability,
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: JSON.stringify(output),
        });
      }
      conversation.push({ role: "user", content: toolResults });
    }
  } finally {
    clearTimeout(timeout);
  }

  const text = lastResponse ? extractAnthropicText(lastResponse) : null;
  if (!text) throw new Error("Anthropic did not return a structured response.");
  // The model occasionally wraps the JSON in code fences despite instructions;
  // strip them defensively before parsing.
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  return input.outputSchema.parse(JSON.parse(stripped));
}
