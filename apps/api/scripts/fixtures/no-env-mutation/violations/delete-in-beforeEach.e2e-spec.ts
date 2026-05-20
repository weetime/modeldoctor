// Fixture: violates the rule. `delete process.env.X` inside beforeEach.
import { beforeEach, describe, it } from "vitest";

describe("violation: delete inside beforeEach", () => {
  beforeEach(() => {
    delete process.env.FOO;
  });

  it("noop", () => {});
});
