import { setupServer } from "msw/node";
import { beforeAll, expect, it } from "vitest";

const server = setupServer();

beforeAll(() => {
  server.listen();
});

it("lets unmocked requests through", () => {
  expect(1).toBe(1);
});
