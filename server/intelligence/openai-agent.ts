import { z } from "zod";
import type { AiObservability } from "./observability";
import type { ToolRegistry } from "./tool-registry";

type ResponseItem = {
  type?: string;
  name?: string;
  arguments?: string;
  call_id?: string;
  content?: Array<{ type?: string; text?: string }>;
};

type ResponsesPayload = Record<string, unknown> & {
  model: string;
  input: unknown[];
  tools?: unknown[];
};

export type ResponseUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
};

export type OpenAiResponse = {
  output?: ResponseItem[];
  output_text?: string;
  usage?: ResponseUsage;
  [key: string]: unknown;
};

export type CreateResponse = (payload: ResponsesPayload, signal: AbortSignal) => Promise<OpenAiResponse>;

const MODEL_PRICES_PER_1M: Record<string, { input: number; cachedInput: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, cachedInput: 0.075, output: 0.6 },
  "gpt-4.1-mini": { input: 0.4, cachedInput: 0.1, output: 1.6 },
  "gpt-5-mini": { input: 0.25, cachedInput: 0.025, output: 2 },
  "gpt-5-nano": { input: 0.05, cachedInput: 0.005, output: 0.4 },
  "gpt-4o": { input: 2.5, cachedInput: 1.25, output: 10 },
  "gpt-4.1": { input: 2, cachedInput: 0.5, output: 8 },
  "gpt-5": { input: 1.25, cachedInput: 0.125, output: 10 },
};

export function estimateOpenAiCost(model: string, usage: ResponseUsage | undefined) {
  const pricing = MODEL_PRICES_PER_1M[model] ?? MODEL_PRICES_PER_1M[model.replace(/-\d{4}-\d{2}-\d{2}$/, "")];
  if (!pricing || !usage) return 0;
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  const uncached = Math.max(input - cached, 0);
  return ((uncached * pricing.input) + (cached * pricing.cachedInput) + (output * pricing.output)) / 1_000_000;
}

export function extractResponseText(response: OpenAiResponse) {
  if (typeof response.output_text === "string") return response.output_text;
  const message = response.output?.find((item) => item.type === "message");
  const content = message?.content?.find((part) => part.type === "output_text" && typeof part.text === "string");
  return content?.text ?? null;
}

function openAiOperatorMessage(status: number, body: string) {
  const lower = body.toLowerCase();
  if (status === 401) {
    if (lower.includes("incorrect api key") || lower.includes("invalid api key")) {
      return "OpenAI authentication failed. Check that Vercel has a valid OPENAI_API_KEY for this project, then redeploy.";
    }
    return "OpenAI authentication failed. Confirm OPENAI_API_KEY is set in Vercel for Production and redeploy.";
  }
  if (status === 403) {
    return "OpenAI rejected the request. Confirm the API key's project has access to the configured DONNIT_AI_MODEL.";
  }
  if (status === 404 && lower.includes("model")) {
    return "OpenAI could not find the configured model. Check DONNIT_AI_MODEL or remove it to use Donnit's default model.";
  }
  if (status === 429) {
    return "OpenAI rate limit or quota was reached. Check project billing, limits, and usage in the OpenAI dashboard.";
  }
  return `OpenAI response failed with status ${status}.`;
}

function functionCalls(response: OpenAiResponse) {
  return (response.output ?? []).filter((item) => item.type === "function_call" && item.name && item.call_id);
}

function tokenCounts(usage: ResponseUsage | undefined) {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cachedInputTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
  };
}

export async function createOpenAiResponse(payload: ResponsesPayload, signal: AbortSignal) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error("[donnit] OpenAI response failed", response.status, body.slice(0, 500));
    throw new Error(openAiOperatorMessage(response.status, body));
  }
  return (await response.json()) as OpenAiResponse;
}

export async function runOpenAiToolLoop<T>(input: {
  skillId: string;
  model: string;
  instructions: string;
  messages: unknown[];
  registry: ToolRegistry;
  toolNames: string[];
  outputSchema: z.ZodType<T>;
  outputJsonSchema: Record<string, unknown>;
  observability: AiObservability;
  allowWrites?: boolean;
  maxToolSteps?: number;
  timeoutMs?: number;
  createResponse?: CreateResponse;
}): Promise<T> {
  const createResponse = input.createResponse ?? createOpenAiResponse;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 12000);
  const requestInput: unknown[] = [
    { role: "system", content: input.instructions },
    ...input.messages,
  ];
  const tools = input.registry.toOpenAiTools(input.toolNames);
  let lastResponse: OpenAiResponse | null = null;
  let totalToolSteps = 0;

  try {
    while (true) {
      const payload: ResponsesPayload = {
        model: input.model,
        input: requestInput,
        tools,
        tool_choice: "auto",
        text: {
          format: {
            type: "json_schema",
            name: input.skillId.replace(/[^a-zA-Z0-9_]/g, "_"),
            strict: true,
            schema: input.outputJsonSchema,
          },
        },
      };
      const started = Date.now();
      try {
        lastResponse = await createResponse(payload, controller.signal);
        const counts = tokenCounts(lastResponse.usage);
        await input.observability.logModelCall({
          skillId: input.skillId,
          model: input.model,
          requestPayload: payload,
          responsePayload: lastResponse,
          latencyMs: Date.now() - started,
          ...counts,
          estimatedCostUsd: estimateOpenAiCost(input.model, lastResponse.usage),
          status: "success",
        });
      } catch (error) {
        await input.observability.logModelCall({
          skillId: input.skillId,
          model: input.model,
          requestPayload: payload,
          responsePayload: {},
          latencyMs: Date.now() - started,
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          totalTokens: 0,
          estimatedCostUsd: 0,
          status: "failed",
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }

      const calls = functionCalls(lastResponse);
      if (calls.length === 0) break;
      totalToolSteps += calls.length;
      if (totalToolSteps > (input.maxToolSteps ?? 3)) throw new Error("AI tool step limit exceeded.");
      requestInput.push(...(lastResponse.output ?? []));
      for (const call of calls) {
        const args = call.arguments ? JSON.parse(call.arguments) : {};
        const output = await input.registry.execute(call.name!, args, {
          orgId: input.observability.session.org_id,
          userId: input.observability.session.user_id ?? "",
          correlationId: input.observability.correlationId,
          allowWrites: input.allowWrites ?? false,
          observability: input.observability,
        });
        requestInput.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(output),
        });
      }
    }
  } finally {
    clearTimeout(timeout);
  }

  const text = lastResponse ? extractResponseText(lastResponse) : null;
  if (!text) throw new Error("OpenAI did not return a structured response.");
  return input.outputSchema.parse(JSON.parse(text));
}
