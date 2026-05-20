// Fixture: violates the rule. process.env is mutated inside beforeAll.
// Loaded by apps/api/scripts/check-e2e-no-env-mutation.test.mjs.
import { beforeAll, describe, it } from "vitest";

describe("violation: assign inside beforeAll", () => {
  beforeAll(async () => {
    process.env.FOO = "bar";
  });

  it("noop", () => {});
});
