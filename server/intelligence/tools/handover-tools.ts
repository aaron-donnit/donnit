import { z } from "zod";
import type { DonnitPositionProfile, DonnitStore } from "../../donnit-store";
import { ToolRegistry } from "../tool-registry";

const uuidLike = z.string().min(1);
const roleInput = z.object({ role_id: uuidLike });

const roleOutput = z.object({
  found: z.boolean(),
  role: z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    current_owner_id: z.string().nullable(),
    direct_manager_id: z.string().nullable(),
    temporary_owner_id: z.string().nullable(),
    delegate_user_id: z.string().nullable(),
    risk_score: z.number(),
    risk_summary: z.string(),
  }).nullable(),
});

const listOpenTasksInput = z.object({
  role_id: uuidLike,
  since: z.string().optional(),
});

const listRecentActivityInput = z.object({
  role_id: uuidLike,
  window_days: z.number().int().min(1).max(180).default(30),
});

const searchMemoryInput = z.object({
  role_id: uuidLike,
  query: z.string().min(1).max(500),
  top_k: z.number().int().min(1).max(20).default(5),
});

const teammateInput = z.object({ teammate_id: uuidLike });

const draftPacketInput = z.object({
  role_id: uuidLike,
  sections: z.array(z.string().min(1)).min(1).max(6),
  outgoing_user: z.string().min(1),
  incoming_user: z.string().min(1).optional(),
  idempotency_key: z.string().min(8),
});

const askUserInput = z.object({
  question: z.string().min(1).max(500),
  options: z.array(z.string().min(1).max(100)).max(8).optional(),
});

const anyObject = z.record(z.unknown());
const listOutput = z.object({ items: z.array(anyObject) });

function objectSchema(properties: Record<string, unknown>, required = Object.keys(properties)) {
  return { type: "object", additionalProperties: false, properties, required };
}

function roleJsonSchema() {
  return objectSchema({ role_id: { type: "string" } });
}

function compactRole(role: DonnitPositionProfile | undefined | null) {
  if (!role) return { found: false, role: null };
  return {
    found: true,
    role: {
      id: role.id,
      title: role.title,
      status: role.status,
      current_owner_id: role.current_owner_id,
      direct_manager_id: role.direct_manager_id,
      temporary_owner_id: role.temporary_owner_id,
      delegate_user_id: role.delegate_user_id,
      risk_score: role.risk_score,
      risk_summary: role.risk_summary,
    },
  };
}

function memorySnippets(role: DonnitPositionProfile, query: string, topK: number) {
  const haystack = role.institutional_memory ?? {};
  const chunks = Object.entries(haystack).map(([key, value]) => ({
    source: `position_profiles.institutional_memory.${key}`,
    snippet: typeof value === "string" ? value : JSON.stringify(value),
    score: String(value).toLowerCase().includes(query.toLowerCase()) ? 0.75 : 0.35,
  }));
  return chunks
    .filter((chunk) => chunk.snippet && chunk.snippet !== "null")
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export function createHandoverToolRegistry(input: { store: DonnitStore; orgId: string }) {
  const registry = new ToolRegistry();
  registry.register({
    name: "get_role",
    description: "Return the role/position profile definition scoped to the workspace.",
    inputSchema: roleInput,
    inputJsonSchema: roleJsonSchema(),
    outputSchema: roleOutput,
    outputJsonSchema: objectSchema({
      found: { type: "boolean" },
      role: { type: ["object", "null"], additionalProperties: true },
    }),
    sideEffect: "read",
    idempotent: true,
    execute: async ({ role_id }) => compactRole((await input.store.listPositionProfiles(input.orgId)).find((role) => role.id === role_id)),
  });
  registry.register({
    name: "list_open_tasks",
    description: "List open tasks owned by the role.",
    inputSchema: listOpenTasksInput,
    inputJsonSchema: objectSchema({ role_id: { type: "string" }, since: { type: "string" } }, ["role_id"]),
    outputSchema: listOutput,
    outputJsonSchema: objectSchema({ items: { type: "array", items: { type: "object", additionalProperties: true } } }),
    sideEffect: "read",
    idempotent: true,
    execute: async ({ role_id, since }) => {
      const sinceTime = since ? new Date(since).getTime() : null;
      const items = (await input.store.listTasks(input.orgId))
        .filter((task) => task.position_profile_id === role_id)
        .filter((task) => !["completed", "denied"].includes(task.status))
        .filter((task) => sinceTime == null || new Date(task.created_at).getTime() >= sinceTime)
        .map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          urgency: task.urgency,
          due_date: task.due_date,
          assigned_to: task.assigned_to,
        }));
      return { items };
    },
  });
  registry.register({
    name: "list_recent_activity",
    description: "List recent task events for tasks attached to the role.",
    inputSchema: listRecentActivityInput,
    inputJsonSchema: objectSchema({ role_id: { type: "string" }, window_days: { type: "number" } }),
    outputSchema: listOutput,
    outputJsonSchema: objectSchema({ items: { type: "array", items: { type: "object", additionalProperties: true } } }),
    sideEffect: "read",
    idempotent: true,
    execute: async ({ role_id, window_days }) => {
      const windowDays = window_days ?? 30;
      const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
      const taskIds = new Set((await input.store.listTasks(input.orgId))
        .filter((task) => task.position_profile_id === role_id)
        .map((task) => task.id));
      const items = (await input.store.listEvents(input.orgId))
        .filter((event) => taskIds.has(event.task_id))
        .filter((event) => new Date(event.created_at).getTime() >= cutoff)
        .map((event) => ({ id: event.id, task_id: event.task_id, type: event.type, note: event.note, created_at: event.created_at }));
      return { items };
    },
  });
  registry.register({
    name: "search_role_memory",
    description: "Search role memory snippets. Stage 1 uses lexical profile memory; Stage 2 upgrades this to hybrid vector retrieval.",
    inputSchema: searchMemoryInput,
    inputJsonSchema: objectSchema({ role_id: { type: "string" }, query: { type: "string" }, top_k: { type: "number" } }),
    outputSchema: listOutput,
    outputJsonSchema: objectSchema({ items: { type: "array", items: { type: "object", additionalProperties: true } } }),
    sideEffect: "read",
    idempotent: true,
    execute: async ({ role_id, query, top_k }) => {
      const role = (await input.store.listPositionProfiles(input.orgId)).find((item) => item.id === role_id);
      return { items: role ? memorySnippets(role, query, top_k ?? 5) : [] };
    },
  });
  registry.register({
    name: "get_teammate",
    description: "Return a teammate profile visible inside the workspace.",
    inputSchema: teammateInput,
    inputJsonSchema: objectSchema({ teammate_id: { type: "string" } }),
    outputSchema: z.object({ found: z.boolean(), teammate: anyObject.nullable() }),
    outputJsonSchema: objectSchema({ found: { type: "boolean" }, teammate: { type: ["object", "null"], additionalProperties: true } }),
    sideEffect: "read",
    idempotent: true,
    execute: async ({ teammate_id }) => {
      const member = (await input.store.listOrgMembers(input.orgId)).find((item) => item.user_id === teammate_id);
      return { found: Boolean(member), teammate: member ?? null };
    },
  });
  registry.register({
    name: "list_relationships",
    description: "Return the role relationship map when present in role memory.",
    inputSchema: roleInput,
    inputJsonSchema: roleJsonSchema(),
    outputSchema: listOutput,
    outputJsonSchema: objectSchema({ items: { type: "array", items: { type: "object", additionalProperties: true } } }),
    sideEffect: "read",
    idempotent: true,
    execute: async ({ role_id }) => {
      const role = (await input.store.listPositionProfiles(input.orgId)).find((item) => item.id === role_id);
      const relationships = role?.institutional_memory?.relationships;
      return { items: Array.isArray(relationships) ? relationships.filter((item) => typeof item === "object") as Record<string, unknown>[] : [] };
    },
  });
  registry.register({
    name: "draft_handover_packet",
    description: "Prepare a handover packet draft artifact. This write tool is permission-gated in v1.",
    inputSchema: draftPacketInput,
    inputJsonSchema: objectSchema({
      role_id: { type: "string" },
      sections: { type: "array", items: { type: "string" } },
      outgoing_user: { type: "string" },
      incoming_user: { type: "string" },
      idempotency_key: { type: "string" },
    }, ["role_id", "sections", "outgoing_user", "idempotency_key"]),
    outputSchema: anyObject,
    outputJsonSchema: { type: "object", additionalProperties: true },
    sideEffect: "write",
    idempotent: true,
    execute: (payload) => ({ persisted: false, artifact_id: null, draft: payload }),
  });
  registry.register({
    name: "ask_user",
    description: "Pause the agent loop and ask the user for required clarification.",
    inputSchema: askUserInput,
    inputJsonSchema: objectSchema({ question: { type: "string" }, options: { type: "array", items: { type: "string" } } }, ["question"]),
    outputSchema: anyObject,
    outputJsonSchema: { type: "object", additionalProperties: true },
    sideEffect: "read",
    idempotent: true,
    execute: (payload) => ({ paused: true, ...payload }),
  });
  return registry;
}
