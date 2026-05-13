import { describe, expect, it } from "vitest";

import {
  executeDonnitComposioTool,
  getDonnitComposioEntityId,
  isReadOnlyComposioToolAllowed,
} from "./composio-client";

describe("Donnit Composio client", () => {
  it("creates stable workspace-scoped entity ids", () => {
    expect(getDonnitComposioEntityId("Org A/Prod", "User@Test.com")).toBe("donnit_org_a_prod_user_test_com");
  });

  it("blocks write tools without explicit confirmation before checking credentials", async () => {
    await expect(
      executeDonnitComposioTool({
        orgId: "org",
        userId: "user",
        toolSlug: "GMAIL_SEND_EMAIL",
        arguments: { to: "test@example.com" },
        sideEffect: "write",
        allowWrites: false,
      }),
    ).rejects.toThrow("requires explicit user confirmation");
  });

  it("allows obvious read tools and rejects obvious write tools", () => {
    expect(isReadOnlyComposioToolAllowed("GMAIL_SEARCH_EMAILS", new Set())).toBe(true);
    expect(isReadOnlyComposioToolAllowed("SLACK_LIST_MESSAGES", new Set())).toBe(true);
    expect(isReadOnlyComposioToolAllowed("GMAIL_SEND_EMAIL", new Set())).toBe(false);
    expect(isReadOnlyComposioToolAllowed("SLACK_POST_MESSAGE", new Set())).toBe(false);
  });

  it("uses an explicit read allowlist when configured", () => {
    const allowlist = new Set(["GMAIL_GET_MESSAGE"]);
    expect(isReadOnlyComposioToolAllowed("GMAIL_GET_MESSAGE", allowlist)).toBe(true);
    expect(isReadOnlyComposioToolAllowed("GMAIL_SEARCH_EMAILS", allowlist)).toBe(false);
  });
});
