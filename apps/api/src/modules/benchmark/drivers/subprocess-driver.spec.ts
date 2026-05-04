import { EventEmitter } from "node:events";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
// Note: 'error' event handler in subprocess-driver.ts is exercised via
// runtime; mock-factory wiring makes a unit test for it disproportionately
// complex. See PR description for rationale.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunExecutionContext } from "./execution-driver.interface.js";
import { SubprocessDriver } from "./subprocess-driver.js";

vi.mock("node:child_process", () => {
  const proc = new EventEmitter() as EventEmitter & {
    pid: number;
    kill: (signal?: NodeJS.Signals) => boolean;
    killed: boolean;
  };
  proc.pid = 12345;
  proc.kill = vi.fn(() => true);
  proc.killed = false;
  return {
    spawn: vi.fn(() => proc),
    __mocked: { proc },
  };
});

const ctx: RunExecutionContext = {
  runId: "abc123",
  tool: "guidellm",
  buildResult: {
    argv: ["echo", "hello"],
    env: { FOO: "bar" },
    secretEnv: { API_KEY: "shh" },
    outputFiles: { report: "report.json" },
  },
  callback: { url: "http://localhost:3001", token: "tk" },
  image: "irrelevant-for-subprocess",
};

let driver: SubprocessDriver;
let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "md-test-"));
  driver = new SubprocessDriver({ cwdRoot: tmpRoot });
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("SubprocessDriver", () => {
  it("creates cwd and spawns wrapper with MD_* env", async () => {
    const { handle } = await driver.start(ctx);
    expect(handle).toBe("subprocess:12345");

    const cwd = path.join(tmpRoot, "run-abc123");
    const stat = await fs.stat(cwd);
    expect(stat.isDirectory()).toBe(true);

    const { spawn } = await import("node:child_process");
    expect(spawn).toHaveBeenCalledTimes(1);
    const call = (spawn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const [cmd, , opts] = call as [string, string[], { env: Record<string, string>; cwd: string }];
    expect(cmd).toBe("benchmark-runner-wrapper");
    expect(opts.cwd).toBe(cwd);
    expect(opts.env.MD_RUN_ID).toBe("abc123");
    expect(opts.env.MD_CALLBACK_URL).toBe("http://localhost:3001");
    expect(opts.env.MD_CALLBACK_TOKEN).toBe("tk");
    expect(JSON.parse(opts.env.MD_ARGV)).toEqual(["echo", "hello"]);
    expect(JSON.parse(opts.env.MD_OUTPUT_FILES)).toEqual({ report: "report.json" });
    expect(opts.env.FOO).toBe("bar");
    expect(opts.env.API_KEY).toBe("shh");
  });

  it("writes inputFiles before spawn", async () => {
    const ctxWithInput: RunExecutionContext = {
      ...ctx,
      buildResult: { ...ctx.buildResult, inputFiles: { "targets.txt": "hello\nworld\n" } },
    };
    await driver.start(ctxWithInput);
    const written = await fs.readFile(path.join(tmpRoot, "run-abc123", "targets.txt"), "utf8");
    expect(written).toBe("hello\nworld\n");
  });

  it("does not leak host secrets into the child env", async () => {
    process.env.DATABASE_URL = "postgres://leak/this";
    process.env.JWT_ACCESS_SECRET = "leak-jwt";
    process.env.BENCHMARK_CALLBACK_SECRET = "leak-hmac";
    process.env.CONNECTION_API_KEY_ENCRYPTION_KEY = "leak-enc";
    try {
      await driver.start(ctx);
      const { spawn } = await import("node:child_process");
      const call = (spawn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
      const [, , opts] = call as [string, string[], { env: Record<string, string> }];
      expect(opts.env.DATABASE_URL).toBeUndefined();
      expect(opts.env.JWT_ACCESS_SECRET).toBeUndefined();
      expect(opts.env.BENCHMARK_CALLBACK_SECRET).toBeUndefined();
      expect(opts.env.CONNECTION_API_KEY_ENCRYPTION_KEY).toBeUndefined();
      // PATH still flows through (allowlisted) so the wrapper binary resolves.
      expect(typeof opts.env.PATH).toBe("string");
    } finally {
      process.env.DATABASE_URL = undefined;
      process.env.JWT_ACCESS_SECRET = undefined;
      process.env.BENCHMARK_CALLBACK_SECRET = undefined;
      process.env.CONNECTION_API_KEY_ENCRYPTION_KEY = undefined;
    }
  });

  it("cancel sends SIGTERM", async () => {
    const { handle } = await driver.start(ctx);
    await driver.cancel(handle);
    const cp = (await import("node:child_process")) as unknown as {
      __mocked: { proc: { kill: ReturnType<typeof vi.fn> } };
    };
    const proc = cp.__mocked.proc;
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
