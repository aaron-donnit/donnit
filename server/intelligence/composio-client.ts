import { Composio } from "@composio/core";

export type ComposioSideEffect = "read" | "write";

export type DonnitComposioToolRequest = {
  orgId: string;
  userId: string;
  toolkits?: string[];
  tools?: string[];
  search?: string;
  limit?: number;
};

export type DonnitComposioExecuteRequest = {
  orgId: string;
  userId: string;
  toolSlug: string;
  arguments: Record<string, unknown>;
  connectedAccountId?: string;
  version?: string;
  sideEffect: ComposioSideEffect;
  allowWrites: boolean;
};

const WRITE_TOOL_PATTERN = /(?:^|_)(?:SEND|CREATE|UPDATE|DELETE|REMOVE|POST|REPLY|DRAFT|INSERT|PATCH|PUT|INVITE|ADD|ARCHIVE|MOVE)(?:_|$)/i;
const READ_TOOL_PATTERN = /(?:^|_)(?:GET|LIST|SEARCH|FETCH|RETRIEVE|READ|QUERY|FIND)(?:_|$)/i;

type ComposioLike = {
  tools: {
    get: (userId: string, filters: string | Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>;
    execute: (slug: string, body: Record<string, unknown>) => Promise<unknown>;
  };
};

let cachedClient: ComposioLike | null = null;

export function isComposioConfigured() {
  return Boolean(process.env.COMPOSIO_API_KEY);
}

export function getDonnitComposioEntityId(orgId: string, userId: string) {
  const clean = `${orgId}_${userId}`
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 180);
  return `donnit_${clean}`;
}

export function getComposioReadToolAllowlist() {
  return new Set(
    (process.env.DONNIT_COMPOSIO_READ_TOOL_ALLOWLIST ?? "")
      .split(",")
      .map((tool) => tool.trim().toUpperCase())
      .filter(Boolean),
  );
}

export function isReadOnlyComposioToolAllowed(toolSlug: string, allowlist = getComposioReadToolAllowlist()) {
  const normalized = toolSlug.trim().toUpperCase();
  if (!normalized) return false;
  if (allowlist.size > 0) return allowlist.has(normalized);
  return READ_TOOL_PATTERN.test(normalized) && !WRITE_TOOL_PATTERN.test(normalized);
}

export function getDonnitComposioClient(): ComposioLike | null {
  if (!process.env.COMPOSIO_API_KEY) return null;
  if (!cachedClient) {
    cachedClient = new Composio({
      apiKey: process.env.COMPOSIO_API_KEY,
      host: "donnit",
      allowTracking: false,
    }) as unknown as ComposioLike;
  }
  return cachedClient;
}

export async function listDonnitComposioTools(input: DonnitComposioToolRequest) {
  const client = getDonnitComposioClient();
  if (!client) {
    return {
      configured: false,
      entityId: getDonnitComposioEntityId(input.orgId, input.userId),
      tools: [],
    };
  }
  const entityId = getDonnitComposioEntityId(input.orgId, input.userId);
  const filters: Record<string, unknown> = {
    ...(input.toolkits?.length ? { toolkits: input.toolkits } : {}),
    ...(input.tools?.length ? { tools: input.tools } : {}),
    ...(input.search ? { search: input.search } : {}),
    limit: input.limit ?? 20,
  };
  const tools = await client.tools.get(entityId, filters);
  return { configured: true, entityId, tools };
}

export async function executeDonnitComposioTool(input: DonnitComposioExecuteRequest) {
  if (input.sideEffect === "write" && !input.allowWrites) {
    throw new Error(`Composio write tool ${input.toolSlug} requires explicit user confirmation.`);
  }
  const client = getDonnitComposioClient();
  if (!client) throw new Error("COMPOSIO_API_KEY is not configured.");
  return client.tools.execute(input.toolSlug, {
    userId: getDonnitComposioEntityId(input.orgId, input.userId),
    arguments: input.arguments,
    ...(input.connectedAccountId ? { connectedAccountId: input.connectedAccountId } : {}),
    ...(input.version ? { version: input.version } : { dangerouslySkipVersionCheck: true }),
  });
}

export async function executeDonnitComposioReadTool(
  input: Omit<DonnitComposioExecuteRequest, "sideEffect" | "allowWrites">,
) {
  if (!isReadOnlyComposioToolAllowed(input.toolSlug)) {
    throw new Error(`Composio tool ${input.toolSlug} is not approved for autonomous read execution.`);
  }
  return executeDonnitComposioTool({
    ...input,
    sideEffect: "read",
    allowWrites: false,
  });
}
