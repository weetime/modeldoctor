// Fixture: violates twice — bracket-access assignment inside a nested
// block inside beforeAll. The nested block tests that brace tracking
// does not exit the hook body early.
import { beforeAll, describe, it } from "vitest";

describe("violation: bracket + nested", () => {
  beforeAll(() => {
    if (Math.random() > 0) {
      process.env["FOO"] = "bar";
    }
    process.env.BAZ = "qux";
  });

  it("noop", () => {});
});
