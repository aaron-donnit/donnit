import { describe, expect, it } from "vitest";

import { executeDonnitComposioTool, getDonnitComposioEntityId } from "./composio-client";

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
});
