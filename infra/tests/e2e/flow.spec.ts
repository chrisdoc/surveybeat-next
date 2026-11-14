// @effect-diagnostics asyncFunction:off -- Playwright's API is promise-based and these specs never enter an Effect.

import { test } from "./fixtures.ts";

/**
 * The SPEC §7 flow on a real stage, one step per test, in order. Each step reads what the earlier
 * steps left in `flow`. A step that its slice has not built yet is `test.fixme`: replace it with the
 * real step when the slice lands, keeping the order.
 */
test.describe.serial("SPEC §7 flow", () => {
  test.fixme("create an Organization", async () => {});
  test.fixme("create a Pulse", async () => {});
  test.fixme("receive the Invitation", async () => {});
  test.fixme("answer from the email", async () => {});
  test.fixme("close the Round", async () => {});
  test.fixme("see the Results", async () => {});
  test.fixme("create an Action", async () => {});
});
