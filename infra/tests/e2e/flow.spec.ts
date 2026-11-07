import { expect, test } from "./fixtures.ts";

/**
 * The SPEC §7 flow on a real stage, one step per test, in order. Each step reads what the earlier
 * steps left in `flow`. A step that its slice has not built yet is `test.fixme`: replace it with the
 * real step when the slice lands, keeping the order.
 */
test.describe.serial("SPEC §7 flow", () => {
  const flow: { organizationId?: string } = {};

  test("create an Organization", async ({ request }) => {
    const created = await request.post("/orgs", { data: { name: "E2E flow" } });
    expect(created.status()).toBe(200);
    const organization: unknown = await created.json();
    expect(organization).toMatchObject({ id: expect.any(String), name: "E2E flow" });
    const id =
      typeof organization === "object" && organization !== null && "id" in organization
        ? organization.id
        : undefined;
    if (typeof id !== "string") throw new Error("POST /orgs returned no id");
    flow.organizationId = id;

    const fetched = await request.get(`/orgs/${id}`);
    expect(fetched.status()).toBe(200);
    expect(await fetched.json()).toEqual(organization);
  });

  test.fixme("create a Pulse", async () => {});
  test.fixme("receive the Invitation", async () => {});
  test.fixme("answer from the email", async () => {});
  test.fixme("close the Round", async () => {});
  test.fixme("see the Results", async () => {});
  test.fixme("create an Action", async () => {});
});
