import { z } from "zod";
import type { AiObservability } from "./observability";

export type ToolSideEffect = "read" | "write";
export type JsonSchema = Record<string, unknown>;

export class ToolPermissionError extends Error {
  constructor(readonly toolName: string) {
    super(`Write tool ${toolName} requires explicit user confirmation.`);
    this.name = "ToolPermissionError";
  }
}

export type ToolExecutionContext = {
  orgId: string;
  userId: string;
  correlationId: string;
  allowWrites: boolean;
  observability?: Pick<AiObservability, "logToolCall">;
};

export type RegisteredTool<I, O> = {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  inputJsonSchema: JsonSchema;
  outputSchema: z.ZodType<O>;
  outputJsonSchema: JsonSchema;
  sideEffect: ToolSideEffect;
  idempotent: boolean;
  execute: (input: I, context: ToolExecutionContext) => Promise<O> | O;
};

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool<unknown, unknown>>();

  register<I, O>(tool: RegisteredTool<I, O>) {
    if (this.tools.has(tool.name)) throw new Error(`Tool already registered: ${tool.name}`);
    this.tools.set(tool.name, tool as RegisteredTool<unknown, unknown>);
    return this;
  }

  get(name: string) {
    return this.tools.get(name) ?? null;
  }

  list() {
    return Array.from(this.tools.values());
  }

  toOpenAiTools(names?: string[]) {
    const allowed = names ? new Set(names) : null;
    return this.list()
      .filter((tool) => !allowed || allowed.has(tool.name))
      .map((tool) => ({
        type: "function",
        name: tool.name,
        description: tool.description,
        strict: true,
        parameters: tool.inputJsonSchema,
      }));
  }

  async execute(name: string, rawInput: unknown, context: ToolExecutionContext) {
    const tool = this.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    const started = Date.now();
    const parsed = tool.inputSchema.safeParse(rawInput);
    const inputPayload = parsed.success ? parsed.data as Record<string, unknown> : { rawInput };
    if (!parsed.success) {
      await context.observability?.logToolCall({
        toolName: tool.name,
        sideEffect: tool.sideEffect,
        inputPayload,
        outputPayload: {},
        latencyMs: Date.now() - started,
        status: "failed",
        errorMessage: parsed.error.message,
      });
      throw parsed.error;
    }
    if (tool.sideEffect === "write" && !context.allowWrites) {
      const error = new ToolPermissionError(tool.name);
      await context.observability?.logToolCall({
        toolName: tool.name,
        sideEffect: tool.sideEffect,
        inputPayload,
        outputPayload: {},
        latencyMs: Date.now() - started,
        status: "permission_denied",
        errorMessage: error.message,
      });
      throw error;
    }
    try {
      const result = await tool.execute(parsed.data, context);
      const output = tool.outputSchema.parse(result);
      await context.observability?.logToolCall({
        toolName: tool.name,
        sideEffect: tool.sideEffect,
        inputPayload,
        outputPayload: output as Record<string, unknown>,
        latencyMs: Date.now() - started,
        status: "success",
      });
      return output;
    } catch (error) {
      await context.observability?.logToolCall({
        toolName: tool.name,
        sideEffect: tool.sideEffect,
        inputPayload,
        outputPayload: {},
        latencyMs: Date.now() - started,
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
