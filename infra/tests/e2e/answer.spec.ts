import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const mockExchangeContext = {
  roundId: "round-test-123",
  pulseName: "Weekly Pulse",
  minimumGroupSize: 4,
  aiProcessing: false,
  questions: [
    {
      id: "q-rating-1",
      position: 1,
      text: "How was your week?",
      type: { _tag: "Rating", lowLabel: "Low", highLabel: "High", comment: true },
    },
    {
      id: "q-rating-2",
      position: 2,
      text: "How manageable was your workload?",
      type: { _tag: "Rating", lowLabel: "Unmanageable", highLabel: "Manageable", comment: true },
    },
    {
      id: "q-choice-3",
      position: 3,
      text: "Which meeting was most valuable?",
      type: { _tag: "SingleChoice", options: ["Stand-up", "Sprint Planning", "Retrospective"] },
    },
  ],
  actions: [
    { id: "act-1", title: "Keep pairing sessions short" },
    { id: "act-2", title: "Update onboarding documentation" },
  ],
  closeTime: 9999999,
  state: "open",
  hasAnswered: false,
};

test.describe("answer page static entry (Issue #44, ADR 0005, ADR 0007, ADR 0008)", () => {
  test("loading a rating link without interacting makes zero answer POSTs (scanner test)", async ({
    page,
  }) => {
    let exchangeCount = 0;
    let answerPostCount = 0;

    await page.route("**/exchange", async (route) => {
      exchangeCount++;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockExchangeContext),
      });
    });

    await page.route("**/first-answer", async (route) => {
      answerPostCount++;
      await route.fulfill({ status: 200, body: JSON.stringify({ saved: true }) });
    });

    await page.route("**/answer", async (route) => {
      answerPostCount++;
      await route.fulfill({ status: 200, body: JSON.stringify({ saved: true }) });
    });

    // 1. Visit with token and preselected rating in fragment: /a#t=token123&v=4
    await page.goto("/a#t=token123&v=4");

    // 2. Fragment must be immediately stripped by replaceState (ADR 0005)
    await page.waitForURL((url) => !url.hash.includes("token123"));
    expect(page.url()).not.toContain("token123");

    // 3. Wait for question text and save button to be enabled
    await expect(page.locator("#q1text")).toHaveText("How was your week?");
    await expect(page.locator("#save")).toBeEnabled();

    // 4. Rating 4 must be preselected
    const radio4 = page.locator('input[name="q1"][value="4"]');
    await expect(radio4).toBeChecked();

    // 5. Anonymity statement must sit directly above "Save and continue"
    const anon = page.locator("#anon");
    await expect(anon).toBeVisible();
    await expect(anon).toContainText("at least 4 people");

    // Wait a moment to ensure no background POSTs fire without user interaction
    await page.waitForTimeout(500);

    // Invariant: Link scanners fetch GET, exchange token, but trigger ZERO answer POSTs
    expect(exchangeCount).toBe(1);
    expect(answerPostCount).toBe(0);
  });

  test("after the first save, no request carries the token (ADR 0005, Invariant A5)", async ({ page }) => {
    const interceptedRequests: Array<{ url: string; postData: Record<string, unknown> }> = [];

    await page.route("**/exchange", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockExchangeContext),
      });
    });

    await page.route("**/first-answer", async (route) => {
      const data: Record<string, unknown> = route.request().postDataJSON();
      interceptedRequests.push({ url: route.request().url(), postData: data });
      await route.fulfill({ status: 200, body: JSON.stringify({ saved: true }) });
    });

    await page.route("**/answer", async (route) => {
      const data: Record<string, unknown> = route.request().postDataJSON();
      interceptedRequests.push({ url: route.request().url(), postData: data });
      await route.fulfill({
        status: 200,
        body: JSON.stringify({ saved: true, shownToLead: "Great team collaboration" }),
      });
    });

    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/a#t=secret-token-xyz&v=5");
    await expect(page.locator("#save")).toBeEnabled();

    // Tap "Save and continue" to confirm first answer
    await page.locator("#save").click();

    // Verify first answer request: carries token and editKeyHash, but NOT editKey
    await expect.poll(() => interceptedRequests.length).toBe(1);
    const firstReq = interceptedRequests[0];
    expect(firstReq?.postData["token"]).toBe("secret-token-xyz");
    expect(firstReq?.postData["value"]).toBe(5);
    expect(typeof firstReq?.postData["editKeyHash"]).toBe("string");
    expect(firstReq?.postData["editKey"]).toBeUndefined();

    // Verify localStorage holds the browser-generated Edit key keyed by Round
    const storedEditKey = await page.evaluate(() => localStorage.getItem("sb_edit_round-test-123"));
    expect(typeof storedEditKey).toBe("string");
    expect(storedEditKey?.length).toBe(64); // 256 bits = 64 hex characters

    // Verify token was removed from sessionStorage
    const sessionToken = await page.evaluate(() => sessionStorage.getItem("sb_token"));
    expect(sessionToken).toBeNull();

    // Now on Screen 2 (Question 2: Rating)
    await expect(page.locator('[data-question-screen="2"] legend')).toHaveText(
      "How manageable was your workload?",
    );

    // Answer Question 2 (select rating 3)
    await page.locator('input[name="q_q-rating-2"][value="3"]').click();

    // Type a comment
    const commentField = page.locator("#comment_q-rating-2");
    await commentField.fill("Great team collaboration");
    await commentField.blur();

    // Verify subsequent requests: MUST CARRY editKey, MUST NOT CARRY token
    await expect.poll(() => interceptedRequests.length).toBeGreaterThanOrEqual(2);
    for (const req of interceptedRequests.slice(1)) {
      expect(req.postData["token"]).toBeUndefined();
      expect(req.postData["editKey"]).toBe(storedEditKey);
    }

    // Verify "Your Lead will see: ..." preview appears under comment
    const leadPreview = page.locator(".lead-preview").first();
    await expect(leadPreview).toContainText("Your Lead will see: Great team collaboration");

    // Proceed to Question 3 (SingleChoice)
    await page.locator('.mobile-next-btn >> text="Next"').click();
    await expect(page.locator('[data-question-screen="3"] legend')).toHaveText(
      "Which meeting was most valuable?",
    );

    // Pick option "Retrospective"
    await page.locator('input[name="q_q-choice-3"][value="2"]').click();

    // Click Finish
    await page.locator('.mobile-next-btn >> text="Finish"').click();

    // Verify Thank You screen and Actions
    await expect(page.locator("#screen-thanks h2")).toHaveText("Thank you!");
    await expect(page.locator("#actions li")).toHaveCount(2);
    await expect(page.locator("#actions li").first()).toHaveText("Keep pairing sessions short");
  });

  test("accessibility audit (WCAG 2.2 AA with axe)", async ({ page }) => {
    await page.route("**/exchange", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockExchangeContext),
      });
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/a#t=token-axe-check&v=3");
    await expect(page.locator("#save")).toBeEnabled();

    // The ends of the scale carry the Question's own labels; 2 to 4 are plain numbers
    await expect(page.locator("#q1low")).toHaveText("1 · Low");
    await expect(page.locator("#q1high")).toHaveText("5 · High");
    await expect(page.locator(".scale label span").nth(1)).toHaveText("2");
    await expect(page.locator(".scale label span").nth(2)).toHaveText("3");
    await expect(page.locator(".scale label span").nth(3)).toHaveText("4");

    // Axe audit on Screen 1
    const screen1Axe = await new AxeBuilder({ page }).analyze();
    expect(screen1Axe.violations).toEqual([]);

    // Check touch target min size (44px)
    const radioLabel = page.locator(".scale label").first();
    const box = await radioLabel.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);

    // No horizontal scroll at 390 px
    expect(await page.evaluate("document.documentElement.scrollWidth")).toBeLessThanOrEqual(390);
  });

  test("desktop layout renders all remaining questions on one page", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });

    await page.route("**/exchange", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockExchangeContext),
      });
    });

    await page.route("**/first-answer", async (route) => {
      await route.fulfill({ status: 200, body: JSON.stringify({ saved: true }) });
    });

    await page.goto("/a#t=token-desktop&v=4");
    await expect(page.locator("#save")).toBeEnabled();
    await page.locator("#save").click();

    // On desktop, all remaining question sections are visible simultaneously
    await expect(page.locator('[data-question-screen="2"]')).toBeVisible();
    await expect(page.locator('[data-question-screen="3"]')).toBeVisible();

    // Mobile next buttons are hidden on desktop
    const mobileNext = page.locator(".mobile-next-btn").first();
    await expect(mobileNext).toBeHidden();

    // Desktop finish button is visible at the bottom
    await expect(page.locator(".desktop-finish-btn")).toBeVisible();
  });

  test("German answer page at /de/a renders in German and strips the token (ADR 0018)", async ({ page }) => {
    await page.route("**/exchange", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockExchangeContext),
      });
    });

    await page.goto("/de/a#t=token123&v=4");
    await expect(page.locator("#save")).toBeEnabled();

    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    await expect(page.locator("#save")).toHaveText("Speichern und weiter");
    expect(page.url()).not.toContain("token123");
  });

  test("displays closed state when round is closed", async ({ page }) => {
    await page.route("**/exchange", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...mockExchangeContext, state: "closed" }),
      });
    });

    await page.goto("/a#t=token-closed");
    await expect(page.locator("#state-message")).toHaveText("This check-in is closed.");
    await expect(page.locator("#screen-1")).toBeHidden();
  });

  test("displays other browser state when already answered without local edit key", async ({ page }) => {
    await page.route("**/exchange", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...mockExchangeContext, hasAnswered: true }),
      });
    });

    await page.goto("/a#t=token-other-browser");
    await expect(page.locator("#state-message")).toContainText(
      "You answered this check-in in another browser",
    );
    await expect(page.locator("#screen-1")).toBeHidden();
  });

  test("without a token the page shows the error and no form", async ({ page }) => {
    await page.goto("/a");
    await expect(page.locator("#err")).toBeVisible();
    await expect(page.locator("#err")).toHaveText("Something went wrong. Please try again.");
    await expect(page.locator("#screen-1")).toBeHidden();
  });

  test("a failed exchange shows the error and no form", async ({ page }) => {
    await page.route("**/exchange", async (route) => {
      await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    });

    await page.goto("/a#t=token-expired");
    await expect(page.locator("#err")).toBeVisible();
    await expect(page.locator("#err")).toHaveText("Something went wrong. Please try again.");
    await expect(page.locator("#screen-1")).toBeHidden();
  });
});
