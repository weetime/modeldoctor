import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ImagesController } from "./images.controller.js";
import type { ImagesService } from "./images.service.js";

type MulterFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
  fieldname?: string;
  encoding?: string;
};

function makeFile(overrides: Partial<MulterFile> = {}): MulterFile {
  return {
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    originalname: "img.png",
    mimetype: "image/png",
    size: 4,
    fieldname: "image",
    encoding: "7bit",
    ...overrides,
  };
}

const validBody = {
  apiBaseUrl: "http://x",
  apiKey: "k",
  model: "gpt-image-1",
  prompt: "make it blue",
};

describe("ImagesController.edit", () => {
  it("rejects when image part is missing", async () => {
    const svc = { runEdit: vi.fn() } as unknown as ImagesService;
    const ctrl = new ImagesController(svc);
    await expect(
      ctrl.edit({ mask: [makeFile({ originalname: "m.png" })] } as never, validBody),
    ).rejects.toThrow(BadRequestException);
    expect(svc.runEdit).not.toHaveBeenCalled();
  });

  it("rejects when mask part is missing", async () => {
    const svc = { runEdit: vi.fn() } as unknown as ImagesService;
    const ctrl = new ImagesController(svc);
    await expect(ctrl.edit({ image: [makeFile()] } as never, validBody)).rejects.toThrow(
      BadRequestException,
    );
  });

  it("rejects when image mime is not png/jpeg/webp", async () => {
    const svc = { runEdit: vi.fn() } as unknown as ImagesService;
    const ctrl = new ImagesController(svc);
    await expect(
      ctrl.edit(
        {
          image: [makeFile({ mimetype: "image/gif" })],
          mask: [makeFile({ originalname: "m.png" })],
        } as never,
        validBody,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects when mask mime is not png", async () => {
    const svc = { runEdit: vi.fn() } as unknown as ImagesService;
    const ctrl = new ImagesController(svc);
    await expect(
      ctrl.edit(
        {
          image: [makeFile()],
          mask: [makeFile({ mimetype: "image/jpeg", originalname: "m.jpg" })],
        } as never,
        validBody,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects when body fails zod (empty prompt)", async () => {
    const svc = { runEdit: vi.fn() } as unknown as ImagesService;
    const ctrl = new ImagesController(svc);
    await expect(
      ctrl.edit({ image: [makeFile()], mask: [makeFile({ originalname: "m.png" })] } as never, {
        ...validBody,
        prompt: "",
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("invokes svc.runEdit with parsed n + files when valid", async () => {
    const runEdit = vi
      .fn()
      .mockResolvedValue({ success: true, artifacts: [{ url: "u" }], latencyMs: 5 });
    const svc = { runEdit } as unknown as ImagesService;
    const ctrl = new ImagesController(svc);
    const out = await ctrl.edit(
      { image: [makeFile()], mask: [makeFile({ originalname: "m.png" })] } as never,
      { ...validBody, n: "2", size: "512x512" },
    );
    expect(out).toEqual({ success: true, artifacts: [{ url: "u" }], latencyMs: 5 });
    expect(runEdit).toHaveBeenCalledOnce();
    const arg = runEdit.mock.calls[0][0];
    expect(arg.n).toBe(2);
    expect(arg.size).toBe("512x512");
    expect(arg.image.originalname).toBe("img.png");
    expect(arg.mask.originalname).toBe("m.png");
    expect(arg.prompt).toBe("make it blue");
  });

  it("converts JSON-encoded customHeaders object to header lines", async () => {
    const runEdit = vi.fn().mockResolvedValue({ success: true, artifacts: [], latencyMs: 1 });
    const svc = { runEdit } as unknown as ImagesService;
    const ctrl = new ImagesController(svc);
    await ctrl.edit({ image: [makeFile()], mask: [makeFile({ originalname: "m.png" })] } as never, {
      ...validBody,
      customHeaders: JSON.stringify({ "X-Org": "abc" }),
    });
    const arg = runEdit.mock.calls[0][0];
    expect(arg.customHeaders).toBe("X-Org: abc");
  });

  it("passes raw header-lines customHeaders through unchanged", async () => {
    const runEdit = vi.fn().mockResolvedValue({ success: true, artifacts: [], latencyMs: 1 });
    const svc = { runEdit } as unknown as ImagesService;
    const ctrl = new ImagesController(svc);
    await ctrl.edit({ image: [makeFile()], mask: [makeFile({ originalname: "m.png" })] } as never, {
      ...validBody,
      customHeaders: "X-Org: abc",
    });
    const arg = runEdit.mock.calls[0][0];
    expect(arg.customHeaders).toBe("X-Org: abc");
  });
});
