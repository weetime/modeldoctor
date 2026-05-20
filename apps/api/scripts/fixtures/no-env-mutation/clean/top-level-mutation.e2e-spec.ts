// Fixture: clean per the rule's scope. The mutation is at top level,
// not inside a beforeAll/beforeEach hook. Out of scope for this lint.
import { describe, it } from "vitest";

process.env.TOP_LEVEL_OK = "1";
delete process.env.TOP_LEVEL_GONE;

describe("clean: top-level mutation", () => {
  it("noop", () => {});
});
