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
