// Fixture: clean. The forbidden patterns appear inside strings and
// comments only — the matcher must strip those before scanning.
import { beforeAll, describe, it } from "vitest";

describe("clean: strings and comments", () => {
  beforeAll(() => {
    // process.env.FOO = 'bar'; (this comment must not trigger)
    /* delete process.env.FOO; */
    const docstring = "do not write `process.env.FOO = 'bar'`";
    const tpl = `also avoid: delete process.env.BAR`;
    if (process.env.NODE_ENV === "test") return;
    void docstring;
    void tpl;
  });

  it("noop", () => {});
});
