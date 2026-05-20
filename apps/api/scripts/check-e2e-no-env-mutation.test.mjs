// Run with: `node --test apps/api/scripts/check-e2e-no-env-mutation.test.mjs`
// or via the wired `pnpm check:e2e-env:test` script.
import test from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findViolations,
  findViolationsInSource,
} from "./check-e2e-no-env-mutation.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// Fixtures live under scripts/ (not test/) so vitest's `test/**/*.e2e-spec.ts`
// include pattern does not pick them up as real e2e tests.
const FIXTURES = resolve(here, "fixtures/no-env-mutation");

test("flags process.env.X = ... inside beforeAll", () => {
  const src = `import { beforeAll } from "vitest";
beforeAll(() => {
  process.env.FOO = "bar";
});
`;
  const hits = findViolationsInSource(src);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 3);
});

test("flags delete process.env.X inside beforeEach", () => {
  const src = `beforeEach(() => {
  delete process.env.FOO;
});
`;
  const hits = findViolationsInSource(src);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 2);
});

test("flags bracket-access assignment", () => {
  const src = `beforeAll(() => {
  process.env["FOO"] = "bar";
});
`;
  const hits = findViolationsInSource(src);
  assert.equal(hits.length, 1);
});

test("flags async-arrow hook bodies", () => {
  const src = `beforeAll(async () => {
  process.env.FOO = "bar";
});
`;
  const hits = findViolationsInSource(src);
  assert.equal(hits.length, 1);
});

test("flags function-expression hook bodies", () => {
  const src = `beforeAll(function () {
  process.env.FOO = "bar";
});
`;
  const hits = findViolationsInSource(src);
  assert.equal(hits.length, 1);
});

test("flags mutations in nested blocks within the hook", () => {
  const src = `beforeAll(() => {
  if (cond) {
    process.env.FOO = "bar";
  }
});
`;
  const hits = findViolationsInSource(src);
  assert.equal(hits.length, 1);
});

test("does not flag equality comparisons", () => {
  const src = `beforeAll(() => {
  if (process.env.FOO === "bar") return;
  if (process.env.BAR == "baz") return;
});
`;
  const hits = findViolationsInSource(src);
  assert.equal(hits.length, 0);
});

test("does not flag reads", () => {
  const src = `beforeAll(() => {
  const x = process.env.FOO;
  const y = process.env["BAR"];
  void x; void y;
});
`;
  const hits = findViolationsInSource(src);
  assert.equal(hits.length, 0);
});

test("does not flag mutations at top level (outside hooks)", () => {
  const src = `process.env.FOO = "bar";
delete process.env.BAR;
describe("x", () => {
  it("y", () => {});
});
`;
  const hits = findViolationsInSource(src);
  assert.equal(hits.length, 0);
});

test("does not flag patterns inside line comments", () => {
  const src = `beforeAll(() => {
  // process.env.FOO = 'bar';
  // delete process.env.BAR;
});
`;
  const hits = findViolationsInSource(src);
  assert.equal(hits.length, 0);
});

test("does not flag patterns inside block comments", () => {
  const src = `beforeAll(() => {
  /* process.env.FOO = 'bar';
     delete process.env.BAR; */
});
`;
  const hits = findViolationsInSource(src);
  assert.equal(hits.length, 0);
});

test("does not flag patterns inside string literals", () => {
  const src = `beforeAll(() => {
  const s = "process.env.FOO = 'bar'";
  const t = 'delete process.env.BAR';
  const u = \`process.env.BAZ = 1\`;
  void s; void t; void u;
});
`;
  const hits = findViolationsInSource(src);
  assert.equal(hits.length, 0);
});

test("findViolations() reports each fixture in violations/", () => {
  const failed = findViolations(resolve(FIXTURES, "violations"));
  const byFile = new Map(failed.map((f) => [f.file.split("/").pop(), f.hits]));
  assert.ok(byFile.has("assign-in-beforeAll.e2e-spec.ts"));
  assert.ok(byFile.has("delete-in-beforeEach.e2e-spec.ts"));
  assert.ok(byFile.has("bracket-and-nested.e2e-spec.ts"));
  assert.equal(byFile.get("bracket-and-nested.e2e-spec.ts").length, 2);
});

test("findViolations() reports nothing in clean/", () => {
  const failed = findViolations(resolve(FIXTURES, "clean"));
  assert.deepEqual(failed, []);
});
