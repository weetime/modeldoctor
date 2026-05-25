import { ForbiddenException, NotFoundException, StreamableFile } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { BenchmarkFilesController } from "./benchmark-files.controller.js";

interface Bench {
  id: string;
  userId: string | null;
  tool: string;
  status: string;
  rawOutput: { files?: Record<string, string> } | null;
}

function makeCtrl(opts: { bench?: Bench | null; fileBytes?: Buffer }) {
  const repo = { findById: vi.fn(async () => opts.bench ?? null) };
  const storage = {
    exists: vi.fn(async () => true),
    readBytes: vi.fn(async () => opts.fileBytes ?? Buffer.from("data")),
    readJson: vi.fn(),
    readText: vi.fn(),
  };
  return {
    ctrl: new BenchmarkFilesController(repo as never, storage as never),
    repo,
    storage,
  };
}

const userU1 = { sub: "u1", roles: [], email: "x@y" };
const userAdmin = { sub: "admin1", roles: ["admin"], email: "a@y" };

describe("BenchmarkFilesController", () => {
  it("404 when benchmark not found", async () => {
    const { ctrl } = makeCtrl({ bench: null });
    await expect(ctrl.getFile(userU1 as never, "r1", "report.json")).rejects.toThrow(
      NotFoundException,
    );
  });

  it("403 when userId mismatch and not admin", async () => {
    const { ctrl } = makeCtrl({
      bench: {
        id: "r1",
        userId: "other-user",
        tool: "guidellm",
        status: "completed",
        rawOutput: { files: { "report.json": "files/report.json" } },
      },
    });
    await expect(ctrl.getFile(userU1 as never, "r1", "report.json")).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("admin can access any user's files", async () => {
    const { ctrl, storage } = makeCtrl({
      bench: {
        id: "r1",
        userId: "other-user",
        tool: "guidellm",
        status: "completed",
        rawOutput: { files: { "report.json": "files/report.json" } },
      },
      fileBytes: Buffer.from("admin-can-see"),
    });
    const out = await ctrl.getFile(userAdmin as never, "r1", "report.json");
    expect(out).toBeInstanceOf(StreamableFile);
    expect(storage.readBytes).toHaveBeenCalledWith("r1/files/report.json");
  });

  it("404 when alias not in rawOutput.files", async () => {
    const { ctrl } = makeCtrl({
      bench: {
        id: "r1",
        userId: "u1",
        tool: "guidellm",
        status: "completed",
        rawOutput: { files: {} },
      },
    });
    await expect(ctrl.getFile(userU1 as never, "r1", "missing.json")).rejects.toThrow(
      NotFoundException,
    );
  });

  it("returns StreamableFile with content for valid request", async () => {
    const { ctrl, storage } = makeCtrl({
      bench: {
        id: "r1",
        userId: "u1",
        tool: "guidellm",
        status: "completed",
        rawOutput: { files: { "report.json": "files/report.json" } },
      },
      fileBytes: Buffer.from('{"ok":true}'),
    });
    const out = await ctrl.getFile(userU1 as never, "r1", "report.json");
    expect(out).toBeInstanceOf(StreamableFile);
    expect(storage.readBytes).toHaveBeenCalledWith("r1/files/report.json");
  });
});
