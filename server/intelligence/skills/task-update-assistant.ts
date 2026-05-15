import { z } from "zod";
import type { DonnitPositionProfile, DonnitStore, DonnitTask } from "../../donnit-store";
import { runOpenAiToolLoop, type CreateResponse } from "../openai-agent";
import { AiObservability } from "../observability";
import { getDonnitModelPolicy } from "../model-policy";
import { ToolRegistry } from "../tool-registry";

const taskContextInputSchema = z.object({
  task_id: z.string().min(1),
});

const taskSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.string(),
  urgency: z.string(),
  due_date: z.string().nullable(),
  due_time: z.string().nullable(),
  estimated_minutes: z.number(),
  assigned_to: z.string(),
  assigned_by: z.string(),
  recurrence: z.string(),
  visibility: z.string(),
  position_profile_id: z.string().nullable(),
  completion_notes: z.string(),
  created_at: z.string(),
});

const taskContextOutputSchema = z.object({
  found: z.boolean(),
  task: taskSummarySchema.nullable(),
  subtasks: z.array(z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    position: z.number(),
    completed_at: z.string().nullable(),
  })),
  recent_events: z.array(z.object({
    id: z.string(),
    type: z.string(),
    note: z.string(),
    created_at: z.string(),
  })),
  position_profile: z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    risk_score: z.number(),
    risk_summary: z.string(),
    institutional_memory: z.record(z.unknown()),
  }).nullable(),
  role_memory: z.array(z.object({
    id: z.string(),
    kind: z.string(),
    title: z.string(),
    body: z.string(),
    markdown_body: z.string().optional(),
    confidence: z.string(),
    importance: z.number().optional(),
    source_kind: z.string().optional(),
    last_seen_at: z.string(),
  })),
  task_memory: z.array(z.object({
    id: z.string(),
    title: z.string(),
    objective: z.string(),
    cadence: z.string(),
    due_rule: z.string(),
    start_offset_days: z.number(),
    default_urgency: z.string(),
    confidence_score: z.number(),
    steps: z.array(z.object({
      title: z.string(),
      instructions: z.string(),
      tool_name: z.string(),
      tool_url: z.string(),
      expected_output: z.string(),
      relative_due_offset_days: z.number(),
      position: z.number(),
    })),
  })),
});

export const taskUpdateAssistantOutputSchema = z.object({
  summary: z.string(),
  suggested_update: z.string(),
  blockers: z.array(z.string()),
  suggested_next_steps: z.array(z.string()),
  profile_memory_candidate: z.string().nullable(),
  confidence: z.enum(["low", "medium", "high"]),
});

export const taskUpdateAssistantOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    suggested_update: { type: "string" },
    blockers: { type: "array", items: { type: "string" } },
    suggested_next_steps: { type: "array", items: { type: "string" } },
    profile_memory_candidate: { type: ["string", "null"] },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
  },
  required: ["summary", "suggested_update", "blockers", "suggested_next_steps", "profile_memory_candidate", "confidence"],
};

export type TaskUpdateAssistantResult = z.infer<typeof taskUpdateAssistantOutputSchema> & {
  correlationId: string;
  estimatedCostUsd: number;
};

function objectSchema(properties: Record<string, unknown>, required = Object.keys(properties)) {
  return { type: "object", additionalProperties: false, properties, required };
}

function compactTask(task: DonnitTask) {
  return {
    id: task.id,
    title: task.title,
    description: task.description ?? "",
    status: task.status,
    urgency: task.urgency,
    due_date: task.due_date,
    due_time: task.due_time,
    estimated_minutes: task.estimated_minutes,
    assigned_to: task.assigned_to,
    assigned_by: task.assigned_by,
    recurrence: task.recurrence,
    visibility: task.visibility,
    position_profile_id: task.position_profile_id,
    completion_notes: task.completion_notes ?? "",
    created_at: task.created_at,
  };
}

function compactProfile(profile: DonnitPositionProfile | null | undefined) {
  if (!profile) return null;
  return {
    id: profile.id,
    title: profile.title,
    status: profile.status,
    risk_score: profile.risk_score,
    risk_summary: profile.risk_summary,
    institutional_memory: profile.institutional_memory ?? {},
  };
}

function taskContextInputJsonSchema() {
  return objectSchema({ task_id: { type: "string" } });
}

function taskContextOutputJsonSchema() {
  return objectSchema({
    found: { type: "boolean" },
    task: { type: ["object", "null"], additionalProperties: true },
    subtasks: { type: "array", items: { type: "object", additionalProperties: true } },
    recent_events: { type: "array", items: { type: "object", additionalProperties: true } },
    position_profile: { type: ["object", "null"], additionalProperties: true },
    role_memory: { type: "array", items: { type: "object", additionalProperties: true } },
    task_memory: { type: "array", items: { type: "object", additionalProperties: true } },
  });
}

export function createTaskUpdateAssistantRegistry(input: { store: DonnitStore; orgId: string }) {
  return new ToolRegistry().register({
    name: "get_task_context",
    description: "Read a Donnit task, its subtasks, recent activity, and role profile context before reporting back.",
    inputSchema: taskContextInputSchema,
    inputJsonSchema: taskContextInputJsonSchema(),
    outputSchema: taskContextOutputSchema,
    outputJsonSchema: taskContextOutputJsonSchema(),
    sideEffect: "read",
    idempotent: true,
    execute: async ({ task_id }) => {
      const task = await input.store.getTask(task_id);
      if (!task || task.org_id !== input.orgId) {
        return { found: false, task: null, subtasks: [], recent_events: [], position_profile: null, role_memory: [], task_memory: [] };
      }
      const [subtasks, events, profiles] = await Promise.all([
        input.store.listTaskSubtasks(input.orgId),
        input.store.listEvents(input.orgId),
        input.store.listPositionProfiles(input.orgId),
      ]);
      const profile = profiles.find((item) => item.id === task.position_profile_id) ?? null;
      const [roleMemory, taskMemory] = profile
        ? await Promise.all([
            input.store.listPositionProfileKnowledge(input.orgId, profile.id),
            input.store.listPositionProfileTaskMemories(input.orgId, profile.id),
          ])
        : [[], []];
      return {
        found: true,
        task: compactTask(task),
        subtasks: subtasks
          .filter((subtask) => subtask.task_id === task.id)
          .map((subtask) => ({
            id: subtask.id,
            title: subtask.title,
            status: subtask.status,
            position: subtask.position,
            completed_at: subtask.completed_at,
          })),
        recent_events: events
          .filter((event) => event.task_id === task.id)
          .slice(0, 12)
          .map((event) => ({
            id: event.id,
            type: event.type,
            note: event.note,
            created_at: event.created_at,
          })),
        position_profile: compactProfile(profile),
        role_memory: roleMemory.slice(0, 12).map((item) => ({
          id: item.id,
          kind: item.kind,
          title: item.title,
          body: item.body,
          markdown_body: item.markdown_body,
          confidence: item.confidence,
          importance: item.importance,
          source_kind: item.source_kind,
          last_seen_at: item.last_seen_at,
        })),
        task_memory: taskMemory
          .filter((memory) => memory.status !== "archived")
          .slice(0, 8)
          .map((memory) => ({
            id: memory.id,
            title: memory.title,
            objective: memory.objective,
            cadence: memory.cadence,
            due_rule: memory.due_rule,
            start_offset_days: memory.start_offset_days,
            default_urgency: memory.default_urgency,
            confidence_score: memory.confidence_score,
            steps: (memory.steps ?? []).slice(0, 10).map((step) => ({
              title: step.title,
              instructions: step.instructions,
              tool_name: step.tool_name,
              tool_url: step.tool_url,
              expected_output: step.expected_output,
              relative_due_offset_days: step.relative_due_offset_days,
              position: step.position,
            })),
          })),
      };
    },
  });
}

export async function draftTaskUpdateWithAgent(input: {
  store: DonnitStore;
  orgId: string;
  userId: string;
  taskId: string;
  instruction: string;
  correlationId?: string;
  createResponse?: CreateResponse;
}): Promise<TaskUpdateAssistantResult> {
  const modelPolicy = getDonnitModelPolicy("assistant_task_update");
  const model = modelPolicy.reasoningProvider === "openai" ? modelPolicy.reasoningModel : modelPolicy.smallModel;
  const observability = await AiObservability.start({
    store: input.store,
    orgId: input.orgId,
    userId: input.userId,
    skillId: "task_update_assistant.v1",
    feature: "assistant_task_update",
    modelPolicy,
    correlationId: input.correlationId,
    metadata: {
      taskId: input.taskId,
      instructionLength: input.instruction.trim().length,
    },
  });

  try {
    const registry = createTaskUpdateAssistantRegistry({ store: input.store, orgId: input.orgId });
    const result = await runOpenAiToolLoop({
      skillId: "task_update_assistant_v1",
      model,
      registry,
      toolNames: ["get_task_context"],
      observability,
      createResponse: input.createResponse,
      timeoutMs: 18000,
      maxToolSteps: 2,
      outputSchema: taskUpdateAssistantOutputSchema,
      outputJsonSchema: taskUpdateAssistantOutputJsonSchema,
      instructions: [
        "You are Donnit's agentic task update assistant.",
        "You reason on behalf of the position profile or task owner, not as a generic chatbot.",
        "You must call get_task_context before answering.",
        "Do not claim to have completed external work; this v1 skill is read-only and reports what should happen next.",
        "Use task notes, subtasks, activity, durable role_memory, task_memory workflows, and position memory when present.",
        "If the instruction asks you to send, submit, change an external system, book something, or do work requiring a connector/write tool you do not have, state that Donnit cannot complete that action yet and provide the exact next step a human should take.",
        "If context is missing, say exactly what is missing and keep confidence low.",
        "Return concise JSON. suggested_update should be written in a human work-update style that can be shown inside Donnit.",
        "profile_memory_candidate should contain one reusable role-learning insight only when the context reveals a repeatable duty, decision rule, relationship, or timing pattern.",
      ].join(" "),
      messages: [{
        role: "user",
        content: JSON.stringify({
          taskId: input.taskId,
          instruction: input.instruction.trim(),
        }),
      }],
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
