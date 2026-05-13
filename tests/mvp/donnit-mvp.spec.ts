import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const seriousConsoleTypes = new Set(["error"]);
const ignoredConsoleFragments = [
  "Failed to load resource: net::ERR_NETWORK_ACCESS_DENIED",
];

async function openDonnit(page: Page) {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (seriousConsoleTypes.has(message.type()) && !ignoredConsoleFragments.some((fragment) => text.includes(fragment))) {
      consoleErrors.push(text);
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.goto("/#/app", { waitUntil: "networkidle" });
  return consoleErrors;
}

async function signedInOrDemo(page: Page) {
  const authCard = page.getByTestId("card-auth");
  if (await authCard.isVisible().catch(() => false)) {
    const email = process.env.DONNIT_TEST_EMAIL ?? "aaron@rosterstack.com";
    const password = process.env.DONNIT_TEST_PASSWORD;
    if (!password) return { mode: "auth-required" as const, email };
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await expect(page.getByTestId("page-command-center")).toBeVisible();
    return { mode: "authenticated" as const, email };
  }
  await expect(page.getByTestId("page-command-center")).toBeVisible();
  return { mode: "demo" as const, email: null };
}

async function attachScreenshot(page: Page, name: string) {
  await test.info().attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
}

async function visibleNavButton(page: Page, view: string) {
  return page.locator(`[data-testid="button-app-nav-${view}"]:visible`).first();
}

async function clickAfterCentering(target: Locator) {
  await target.evaluate((element) => {
    element.scrollIntoView({ block: "center", inline: "center" });
  });
  await target.click();
}

async function clickNav(page: Page, view: string) {
  const button = await visibleNavButton(page, view);
  await clickAfterCentering(button);
}

test("MVP shell, navigation, and search are usable", async ({ page, isMobile }) => {
  const consoleErrors = await openDonnit(page);
  const state = await signedInOrDemo(page);
  test.info().annotations.push({ type: "mode", description: state.mode });
  if (state.mode === "auth-required") {
    test.skip(true, `Authenticated smoke requires DONNIT_TEST_PASSWORD for ${state.email}.`);
  }

  await expect(page.getByTestId("page-command-center")).toBeVisible();
  await expect(page.getByTestId("panel-tasks")).toBeVisible();
  await attachScreenshot(page, `shell-${isMobile ? "mobile" : "desktop"}`);

  const views = ["tasks", "agenda", "inbox", "profiles", "reports", "admin", "settings"];
  for (const view of views) {
    const nav = await visibleNavButton(page, view);
    if (!(await nav.isVisible().catch(() => false)) || await nav.isDisabled().catch(() => false)) continue;
    await clickNav(page, view);
    if (view === "tasks") await expect(page.getByTestId("panel-tasks")).toBeVisible();
    if (view === "agenda") await expect(page.getByTestId("panel-agenda")).toBeVisible();
    if (view === "profiles") await expect(page.getByTestId("panel-position-profiles")).toBeVisible();
  }

  if (!isMobile) {
    await page.getByTestId("input-global-search").fill("report");
    await expect(page.locator("[data-testid^='button-search-result-']").first().or(page.getByText("No matching work found."))).toBeVisible();
    await page.keyboard.press("Escape");
  }

  expect(consoleErrors, `Browser console/page errors:\n${consoleErrors.join("\n")}`).toEqual([]);
});

test("chat creates or clarifies a baseline task without breaking the task list", async ({ page }) => {
  const consoleErrors = await openDonnit(page);
  const state = await signedInOrDemo(page);
  if (state.mode === "auth-required") {
    test.skip(true, `Authenticated smoke requires DONNIT_TEST_PASSWORD for ${state.email}.`);
  }

  await clickNav(page, "home");
  await expect(page.getByTestId("input-chat-message")).toBeVisible();
  await page.getByTestId("input-chat-message").fill("I need to prepare the Friday status report by EOW");
  await page.getByTestId("button-send-chat").click();
  await expect(page.getByTestId("text-chat-latest-response")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("panel-tasks")).toBeVisible();
  await page.getByTestId("button-task-view-active").click();
  await expect(page.getByText(/status report|Friday/i).first()).toBeVisible({ timeout: 10_000 });
  expect(consoleErrors, `Browser console/page errors:\n${consoleErrors.join("\n")}`).toEqual([]);
});

test("Needs Review, agenda, and Position Profiles expose the MVP continuity controls", async ({ page }) => {
  const consoleErrors = await openDonnit(page);
  const state = await signedInOrDemo(page);
  if (state.mode === "auth-required") {
    test.skip(true, `Authenticated smoke requires DONNIT_TEST_PASSWORD for ${state.email}.`);
  }

  await clickNav(page, "tasks");
  await expect(page.getByTestId("panel-tasks")).toBeVisible();
  await clickAfterCentering(page.getByTestId("button-task-view-review"));
  await expect(page.getByTestId("task-group-head-review").or(page.getByText("Nothing needs review."))).toBeVisible();

  await clickNav(page, "agenda");
  await expect(page.getByTestId("panel-agenda")).toBeVisible();
  await expect(page.getByTestId("button-panel-build-agenda")).toBeVisible();
  await expect(page.getByTestId("button-panel-export-agenda")).toBeVisible();

  const profilesNav = await visibleNavButton(page, "profiles");
  if (await profilesNav.isDisabled().catch(() => true)) {
    test.info().annotations.push({ type: "profiles", description: "Position Profiles disabled for this user." });
  } else {
    await clickAfterCentering(profilesNav);
    await expect(page.getByTestId("panel-position-profiles")).toBeVisible();
    await expect(page.getByTestId("position-profile-status-filters")).toBeVisible();
    await expect(page.getByTestId("input-position-profile-list-search")).toBeVisible();
    const firstProfile = page.locator("[data-testid^='position-profile-row-']").first();
    if (await firstProfile.isVisible().catch(() => false)) {
      await firstProfile.click();
      await expect(page.getByTestId("panel-position-profile-search")).toBeVisible();
      await page.getByTestId("input-position-profile-task-search").fill("report");
      await expect(page.getByTestId("position-profile-search-results")).toBeVisible();
      await expect(page.getByTestId("button-position-profile-actions")).toBeVisible();
    }
  }

  expect(consoleErrors, `Browser console/page errors:\n${consoleErrors.join("\n")}`).toEqual([]);
});

test("basic accessibility scan does not find critical violations on the main workspace", async ({ page }) => {
  await openDonnit(page);
  const state = await signedInOrDemo(page);
  if (state.mode === "auth-required") {
    test.skip(true, `Authenticated smoke requires DONNIT_TEST_PASSWORD for ${state.email}.`);
  }
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const violations = results.violations;
  const serious = violations.filter((violation) => ["critical", "serious"].includes(violation.impact ?? ""));
  expect(
    serious.map((violation) => `${violation.id}: ${violation.help}`).join("\n"),
    "Critical/serious accessibility violations",
  ).toBe("");
});
