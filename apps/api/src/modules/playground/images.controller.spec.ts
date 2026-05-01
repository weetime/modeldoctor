import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import type { ConnectionService, DecryptedConnection } from "../connection/connection.service.js";
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

function makeConn(): DecryptedConnection {
  return {
    id: "conn-1",
    name: "test",
    baseUrl: "http://x",
    apiKey: "k",
    model: "gpt-image-1",
    customHeaders: "",
    queryParams: "",
    category: "image",
  };
}

function makeUser(): JwtPayload {
  return { sub: "user-1", email: "u@example.com", roles: [] };
}

const validBody = {
  connectionId: "conn-1",
  prompt: "make it blue",
};

function makeConnectionsMock() {
  const getOwnedDecrypted = vi.fn().mockResolvedValue(makeConn());
  return {
    mock: { getOwnedDecrypted } as unknown as ConnectionService,
    getOwnedDecrypted,
  };
}

describe("ImagesController.edit", () => {
  it("rejects when image part is missing", async () => {
    const svc = { runEdit: vi.fn() } as unknown as ImagesService;
    const { mock: connections, getOwnedDecrypted } = makeConnectionsMock();
    const ctrl = new ImagesController(svc, connections);
    await expect(
      ctrl.edit(makeUser(), { mask: [makeFile({ originalname: "m.png" })] } as never, validBody),
    ).rejects.toThrow(BadRequestException);
    expect(svc.runEdit).not.toHaveBeenCalled();
    expect(getOwnedDecrypted).not.toHaveBeenCalled();
  });

  it("rejects when mask part is missing", async () => {
    const svc = { runEdit: vi.fn() } as unknown as ImagesService;
    const { mock: connections } = makeConnectionsMock();
    const ctrl = new ImagesController(svc, connections);
    await expect(
      ctrl.edit(makeUser(), { image: [makeFile()] } as never, validBody),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects when image mime is not png/jpeg/webp", async () => {
    const svc = { runEdit: vi.fn() } as unknown as ImagesService;
    const { mock: connections } = makeConnectionsMock();
    const ctrl = new ImagesController(svc, connections);
    await expect(
      ctrl.edit(
        makeUser(),
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
    const { mock: connections } = makeConnectionsMock();
    const ctrl = new ImagesController(svc, connections);
    await expect(
      ctrl.edit(
        makeUser(),
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
    const { mock: connections } = makeConnectionsMock();
    const ctrl = new ImagesController(svc, connections);
    await expect(
      ctrl.edit(
        makeUser(),
        { image: [makeFile()], mask: [makeFile({ originalname: "m.png" })] } as never,
        {
          ...validBody,
          prompt: "",
        },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("invokes svc.runEdit with parsed n + files when valid", async () => {
    const runEdit = vi
      .fn()
      .mockResolvedValue({ success: true, artifacts: [{ url: "u" }], latencyMs: 5 });
    const svc = { runEdit } as unknown as ImagesService;
    const { mock: connections, getOwnedDecrypted } = makeConnectionsMock();
    const ctrl = new ImagesController(svc, connections);
    const out = await ctrl.edit(
      makeUser(),
      { image: [makeFile()], mask: [makeFile({ originalname: "m.png" })] } as never,
      { ...validBody, n: "2", size: "512x512" },
    );
    expect(out).toEqual({ success: true, artifacts: [{ url: "u" }], latencyMs: 5 });
    expect(getOwnedDecrypted).toHaveBeenCalledWith("user-1", "conn-1");
    expect(runEdit).toHaveBeenCalledOnce();
    const [conn, arg] = runEdit.mock.calls[0];
    expect(conn.id).toBe("conn-1");
    expect(arg.n).toBe(2);
    expect(arg.size).toBe("512x512");
    expect(arg.image.originalname).toBe("img.png");
    expect(arg.mask.originalname).toBe("m.png");
    expect(arg.prompt).toBe("make it blue");
  });
});
