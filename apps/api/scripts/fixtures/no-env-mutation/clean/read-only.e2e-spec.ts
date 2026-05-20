// Fixture: clean. Reads process.env inside beforeAll, never writes.
import { beforeAll, describe, it } from "vitest";

describe("clean: read-only", () => {
  let token: string | undefined;

  beforeAll(() => {
    token = process.env.MCP_BEARER_TOKEN;
    if (process.env.NODE_ENV === "test") return;
  });

  it("noop", () => {
    void token;
  });
});
