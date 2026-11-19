// @effect-diagnostics asyncFunction:off -- Playwright's API is promise-based and these specs never enter an Effect.

import type { Page } from "@playwright/test";
import { expect, open, test } from "./fixtures.ts";
import { stubSignedIn } from "./signed-in.ts";

/**
 * The signed-in screens the polish pass changed (C4, #160): the People table's per-row actions, the
 * Teams rows that carry their facts, and a Ready Round's Review and share. The reads are stubbed by
 * `signed-in.ts`; what is under test is the screens.
 *
 * The `chromium` and `phone` projects both run this file, so every assertion below also holds at a
 * 393 px phone width, where these layouts are the easiest to break.
 */
type Box = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

const boxesOverlap = (a: Box | null, b: Box | null): boolean =>
  a !== null &&
  b !== null &&
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

const expectNoHorizontalScroll = async (page: Page): Promise<void> => {
  const scrollWidth = Number(await page.evaluate("document.documentElement.scrollWidth"));
  const width = page.viewportSize()?.width ?? 0;
  expect(scrollWidth, `scroll width at ${width} px`).toBeLessThanOrEqual(width);
};

test("a Person's actions open from their own row in Settings, and only theirs", async ({
  page,
  pageErrors,
}) => {
  await stubSignedIn(page);
  await open(page, "/settings");

  const ada = page.getByRole("row").filter({ hasText: "ada@example.com" });
  const grace = page.getByRole("row").filter({ hasText: "grace@example.com" });

  // Closed, each row shows only its Actions disclosure; the actions stay out of the way until asked.
  // Chromium exposes a native `summary` as a disclosure, not as a button, so the toggle is found by
  // its element and its own open state is what the assertions follow.
  const toggle = ada.locator("summary");
  await expect(toggle).toBeVisible();
  await expect(toggle).toContainText("Actions");
  await expect(ada.locator("details")).not.toHaveAttribute("open", "");
  await expect(ada.getByRole("button", { name: "Make admin" })).toBeHidden();
  await expect(ada.getByRole("button", { name: "Remove from Organization" })).toBeHidden();

  await toggle.click();
  await expect(ada.locator("details")).toHaveAttribute("open", "");
  await expect(ada.getByRole("button", { name: "Make admin" })).toBeVisible();
  await expect(ada.getByRole("button", { name: "Remove from Organization" })).toBeVisible();

  // Ada's disclosure opens Ada's actions only: the admin's row is still closed.
  await expect(grace.getByRole("button", { name: "Revoke admin" })).toBeHidden();

  await expectNoHorizontalScroll(page);
  expect(pageErrors).toEqual([]);
});

test("the People table stacks each Person at a phone width, with the pill on one line", async ({
  page,
  pageErrors,
}, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "the stacked People rows are the phone layout");

  await stubSignedIn(page);
  await open(page, "/settings");

  const linus = page.getByRole("row").filter({ hasText: "linus@example.com" });
  const emailCell = linus.getByRole("cell").first();
  const emailBox = await emailCell.boundingBox();
  const actionsBox = await linus.locator("summary").boundingBox();
  const roleBox = await linus.getByText("Member", { exact: true }).boundingBox();
  expect(emailBox).not.toBeNull();
  expect(actionsBox).not.toBeNull();
  expect(roleBox).not.toBeNull();
  // The email (and the not-signed-in pill beside it) fill the first line; the role and Actions sit beneath.
  expect(actionsBox?.y ?? 0).toBeGreaterThanOrEqual((emailBox?.y ?? 0) + (emailBox?.height ?? 0));
  expect(roleBox?.y ?? 0).toBeGreaterThanOrEqual((emailBox?.y ?? 0) + (emailBox?.height ?? 0));

  // The pill stays on the screen and does not sit on top of the email.
  const pill = linus.getByText("hasn't signed in yet", { exact: true });
  await expect(pill).toBeVisible();
  const pillBox = await pill.boundingBox();
  const email = linus.getByText("linus@example.com");
  const emailText = await email.boundingBox();
  const viewportWidth = page.viewportSize()?.width ?? 0;
  expect(pillBox).not.toBeNull();
  expect(emailText).not.toBeNull();
  expect((pillBox?.x ?? 0) + (pillBox?.width ?? 0)).toBeLessThanOrEqual(viewportWidth);
  expect(boxesOverlap(pillBox, emailText)).toBe(false);

  await expectNoHorizontalScroll(page);
  expect(pageErrors).toEqual([]);
});

test("a Team roster row's Actions panel stays inside the phone screen", async ({
  page,
  pageErrors,
}, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "the roster menu is checked at phone width");

  await stubSignedIn(page);
  await open(page, "/teams/team-1");

  const ada = page.getByRole("listitem").filter({ hasText: "ada@example.com" });
  await ada.locator("summary").click();
  const panel = ada.locator("details > div");
  await expect(panel.getByRole("button", { name: "Remove as Lead" })).toBeVisible();

  const panelBox = await panel.boundingBox();
  const viewportWidth = page.viewportSize()?.width ?? 0;
  expect(panelBox).not.toBeNull();
  expect(panelBox?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((panelBox?.x ?? 0) + (panelBox?.width ?? 0)).toBeLessThanOrEqual(viewportWidth);

  await expectNoHorizontalScroll(page);
  expect(pageErrors).toEqual([]);
});

test("a Teams row shows its member count and next Round together", async ({ page, pageErrors }) => {
  await stubSignedIn(page);
  await open(page, "/");

  const team = page.getByRole("link").filter({ hasText: "Platform" });
  await expect(team).toBeVisible();
  // Both facts are the row's own line, separated by a middle dot: "5 people · Next Round Mar 2, 2026".
  await expect(team).toContainText("5 people");
  await expect(team).toContainText(/Next Round .*2026/);
  await expect(team).toContainText("5 people · Next Round");

  await expectNoHorizontalScroll(page);
  expect(pageErrors).toEqual([]);
});

test("a Ready Round offers Review and share, opening its Results", async ({ page, pageErrors }) => {
  await stubSignedIn(page);
  await open(page, "/teams/team-1/pulses/pulse-1/rounds");

  const review = page.getByRole("link", { name: "Review and share" });
  await expect(review).toBeVisible();
  await expect(review).toHaveAttribute("href", "/teams/team-1/rounds/round-1");
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();

  await expectNoHorizontalScroll(page);
  expect(pageErrors).toEqual([]);
});
