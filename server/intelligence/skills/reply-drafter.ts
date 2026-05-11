import { z } from "zod";
import type { DonnitEmailSuggestion, DonnitStore } from "../../donnit-store";
import { runOpenAiToolLoop, type CreateResponse } from "../openai-agent";
import { AiObservability } from "../observability";
import { ToolRegistry } from "../tool-registry";

const getSuggestionInputSchema = z.object({
  suggestion_id: z.string().min(1),
});

const getSuggestionOutputSchema = z.object({
  found: z.boolean(),
  source: z.enum(["email", "slack", "sms", "document"]),
  from: z.string(),
  subject: z.string(),
  source_body: z.string(),
  task: z.object({
    title: z.string(),
    due_date: z.string().nullable(),
    urgency: z.enum(["low", "normal", "high", "critical"]),
    action_items: z.array(z.string()),
  }),
  reply_scenario: z.string(),
});

export const replyDraftOutputSchema = z.object({
  message: z.string(),
  rationale: z.string(),
});

export const replyDraftOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    message: { type: "string" },
    rationale: { type: "string" },
  },
  required: ["message", "rationale"],
};

export type ReplyDraftResult = z.infer<typeof replyDraftOutputSchema> & {
  correlationId: string;
  estimatedCostUsd: number;
};

function suggestionInputJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      suggestion_id: { type: "string" },
    },
    required: ["suggestion_id"],
  };
}

function suggestionOutputJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      found: { type: "boolean" },
      source: { type: "string", enum: ["email", "slack", "sms", "document"] },
      from: { type: "string" },
      subject: { type: "string" },
      source_body: { type: "string" },
      task: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          due_date: { type: ["string", "null"] },
          urgency: { type: "string", enum: ["low", "normal", "high", "critical"] },
          action_items: { type: "array", items: { type: "string" } },
        },
        required: ["title", "due_date", "urgency", "action_items"],
      },
      reply_scenario: { type: "string" },
    },
    required: ["found", "source", "from", "subject", "source_body", "task", "reply_scenario"],
  };
}

export function createReplyDrafterRegistry(input: {
  store: DonnitStore;
  sourceFromSuggestion: (suggestion: { fromEmail: string; subject: string }) => "email" | "slack" | "sms" | "document";
  replyScenario: (suggestion: Pick<DonnitEmailSuggestion, "subject" | "suggested_title" | "preview"> & { body?: string | null }) => string;
}) {
  return new ToolRegistry().register({
    name: "get_email_suggestion_context",
    description: "Read the imported message and Donnit task suggestion that need a reply draft.",
    inputSchema: getSuggestionInputSchema,
    inputJsonSchema: suggestionInputJsonSchema(),
    outputSchema: getSuggestionOutputSchema,
    outputJsonSchema: suggestionOutputJsonSchema(),
    sideEffect: "read",
    idempotent: true,
    execute: async ({ suggestion_id }) => {
      const suggestion = await input.store.getEmailSuggestion(suggestion_id);
      if (!suggestion) {
        return {
          found: false,
          source: "email" as const,
          from: "",
          subject: "",
          source_body: "",
          task: { title: "", due_date: null, urgency: "normal" as const, action_items: [] },
          reply_scenario: "missing",
        };
      }
      return {
        found: true,
        source: input.sourceFromSuggestion({
          fromEmail: suggestion.from_email,
          subject: suggestion.subject,
        }),
        from: suggestion.from_email,
        subject: suggestion.subject,
        source_body: suggestion.body,
        task: {
          title: suggestion.suggested_title,
          due_date: suggestion.suggested_due_date,
          urgency: suggestion.urgency,
          action_items: suggestion.action_items ?? [],
        },
        reply_scenario: input.replyScenario(suggestion),
      };
    },
  });
}

export async function draftSuggestionReplyWithAgent(input: {
  store: DonnitStore;
  orgId: string;
  userId: string;
  suggestionId: string;
  instruction?: string;
  sourceFromSuggestion: (suggestion: { fromEmail: string; subject: string }) => "email" | "slack" | "sms" | "document";
  replyScenario: (suggestion: Pick<DonnitEmailSuggestion, "subject" | "suggested_title" | "preview"> & { body?: string | null }) => string;
  createResponse?: CreateResponse;
}): Promise<ReplyDraftResult> {
  const model = process.env.DONNIT_AI_MODEL ?? "gpt-4o-mini";
  const observability = await AiObservability.start({
    store: input.store,
    orgId: input.orgId,
    userId: input.userId,
    skillId: "suggestion_reply_drafter.v1",
    feature: "suggestion_reply_draft",
    modelPolicy: {
      provider: "openai",
      smallModel: model,
      reasoningModel: process.env.DONNIT_REASONING_MODEL ?? model,
    },
    metadata: {
      suggestionId: input.suggestionId,
      hasInstruction: Boolean(input.instruction?.trim()),
    },
  });
  try {
    const registry = createReplyDrafterRegistry({
      store: input.store,
      sourceFromSuggestion: input.sourceFromSuggestion,
      replyScenario: input.replyScenario,
    });
    const result = await runOpenAiToolLoop({
      skillId: "suggestion_reply_drafter_v1",
      model,
      registry,
      toolNames: ["get_email_suggestion_context"],
      observability,
      createResponse: input.createResponse,
      timeoutMs: 12000,
      maxToolSteps: 2,
      outputSchema: replyDraftOutputSchema,
      outputJsonSchema: replyDraftOutputJsonSchema,
      instructions: [
        "You are Donnit's reply drafting skill.",
        "You must call get_email_suggestion_context before drafting.",
        "Write the reply as the Donnit user responding to the sender.",
        "Do not copy the inbound message or restate Donnit's internal task.",
        "If the sender is scheduling, propose a practical scheduling next step and ask for availability or a calendar link.",
        "If the sender requests approval, say you will review and follow up with a decision or questions.",
        "If the sender sent a document, say you will review and send comments or next steps.",
        "Never invent dates, prices, approvals, attachments, legal conclusions, or calendar availability.",
        "Return concise JSON with a ready-to-edit message and a short rationale.",
      ].join(" "),
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            suggestionId: input.suggestionId,
            userInstruction: input.instruction?.trim() || null,
          }),
        },
      ],
    });
    await observability.finish("completed", { estimatedCostUsd: observability.totalEstimatedCostUsd });
    return {
      ...result,
      correlationId: observability.correlationId,
      estimatedCostUsd: observability.totalEstimatedCostUsd,
    };
  } catch (error) {
    await observability.finish("failed", {
      error: error instanceof Error ? error.message : String(error),
      estimatedCostUsd: observability.totalEstimatedCostUsd,
    });
    throw error;
  }
}
