import crypto from "node:crypto";
import type { DonnitAiSession, DonnitStore } from "../donnit-store";

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /\+?\d[\d\s().-]{7,}\d/g;
const TOKEN_RE = /\b(?:ya29|xox[baprs]-|sk-[A-Za-z0-9_-]+)[A-Za-z0-9._-]*/g;

export function createCorrelationId(prefix = "ai") {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function redactForLogs(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[MaxDepth]";
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    const redacted = value
      .replace(EMAIL_RE, "[email]")
      .replace(PHONE_RE, "[phone]")
      .replace(TOKEN_RE, "[secret]");
    return redacted.length > 2000 ? `${redacted.slice(0, 2000)}...[truncated]` : redacted;
  }
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => redactForLogs(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      const lowered = key.toLowerCase();
      if (lowered.includes("token") || lowered.includes("secret") || lowered.includes("authorization")) {
        out[key] = "[secret]";
      } else {
        out[key] = redactForLogs(raw, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

export class AiObservability {
  private totalCost = 0;

  constructor(
    private readonly store: DonnitStore,
    private readonly orgId: string,
    private readonly userId: string,
    readonly session: DonnitAiSession,
  ) {}

  static async start(input: {
    store: DonnitStore;
    orgId: string;
    userId: string;
    correlationId?: string;
    skillId: string;
    feature: string;
    modelPolicy: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }) {
    const session = await input.store.createAiSession(input.orgId, {
      correlation_id: input.correlationId ?? createCorrelationId(),
      skill_id: input.skillId,
      feature: input.feature,
      model_policy: input.modelPolicy,
      metadata: input.metadata ?? {},
    });
    return new AiObservability(input.store, input.orgId, input.userId, session);
  }

  get correlationId() {
    return this.session.correlation_id;
  }

  get totalEstimatedCostUsd() {
    return this.totalCost;
  }

  async logModelCall(input: {
    skillId: string;
    model: string;
    requestPayload: Record<string, unknown>;
    responsePayload: Record<string, unknown>;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    status: "success" | "failed";
    errorMessage?: string | null;
  }) {
    this.totalCost += input.estimatedCostUsd;
    await this.store.createAiModelCall({
      session_id: this.session.id,
      org_id: this.orgId,
      user_id: this.userId,
      correlation_id: this.correlationId,
      skill_id: input.skillId,
      model: input.model,
      request_payload: redactForLogs(input.requestPayload) as Record<string, unknown>,
      response_payload: redactForLogs(input.responsePayload) as Record<string, unknown>,
      latency_ms: input.latencyMs,
      input_tokens: input.inputTokens,
      output_tokens: input.outputTokens,
      cached_input_tokens: input.cachedInputTokens,
      total_tokens: input.totalTokens,
      estimated_cost_usd: input.estimatedCostUsd,
      status: input.status,
      error_message: input.errorMessage ?? null,
    });
  }

  async logToolCall(input: {
    toolName: string;
    sideEffect: "read" | "write";
    inputPayload: Record<string, unknown>;
    outputPayload: Record<string, unknown>;
    latencyMs: number;
    status: "success" | "failed" | "permission_denied";
    errorMessage?: string | null;
  }) {
    await this.store.createAiToolCall({
      session_id: this.session.id,
      org_id: this.orgId,
      user_id: this.userId,
      correlation_id: this.correlationId,
      tool_name: input.toolName,
      side_effect: input.sideEffect,
      input_payload: redactForLogs(input.inputPayload) as Record<string, unknown>,
      output_payload: redactForLogs(input.outputPayload) as Record<string, unknown>,
      latency_ms: input.latencyMs,
      status: input.status,
      error_message: input.errorMessage ?? null,
    });
  }

  async finish(status: "completed" | "failed" | "cancelled", metadata: Record<string, unknown> = {}) {
    await this.store.updateAiSession(this.session.id, {
      status,
      estimated_cost_usd: this.totalCost,
      metadata,
      completed_at: new Date().toISOString(),
    });
  }
}
