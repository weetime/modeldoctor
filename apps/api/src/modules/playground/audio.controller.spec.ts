import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import type { ConnectionService, DecryptedConnection } from "../connection/connection.service.js";
import { AudioController } from "./audio.controller.js";
import { AudioService } from "./audio.service.js";

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
    buffer: Buffer.from([1, 2, 3]),
    originalname: "audio.wav",
    mimetype: "audio/wav",
    size: 3,
    fieldname: "file",
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
    model: "whisper-1",
    customHeaders: "",
    queryParams: "",
    category: "audio",
    tokenizerHfId: null,
  };
}

function makeUser(): JwtPayload {
  return { sub: "user-1", email: "u@example.com", roles: [] };
}

function makeConnectionsMock() {
  const getOwnedDecrypted = vi.fn().mockResolvedValue(makeConn());
  return {
    mock: { getOwnedDecrypted } as unknown as ConnectionService,
    getOwnedDecrypted,
  };
}

describe("AudioController.transcriptions", () => {
  it("rejects when file is missing", async () => {
    const svc = { runTranscriptions: vi.fn() } as unknown as AudioService;
    const { mock: connections } = makeConnectionsMock();
    const ctrl = new AudioController(svc, connections);
    await expect(
      ctrl.transcriptions(makeUser(), undefined as never, { connectionId: "conn-1" }),
    ).rejects.toThrow(BadRequestException);
    expect(svc.runTranscriptions).not.toHaveBeenCalled();
  });

  it("rejects when form fields fail zod", async () => {
    const svc = { runTranscriptions: vi.fn() } as unknown as AudioService;
    const { mock: connections } = makeConnectionsMock();
    const ctrl = new AudioController(svc, connections);
    await expect(
      ctrl.transcriptions(makeUser(), makeFile() as never, { connectionId: "" }),
    ).rejects.toThrow(BadRequestException);
  });

  it("invokes svc.runTranscriptions with conn + file + parsed body when valid", async () => {
    const runTranscriptions = vi
      .fn()
      .mockResolvedValue({ success: true, text: "hi", latencyMs: 5 });
    const svc = { runTranscriptions } as unknown as AudioService;
    const { mock: connections, getOwnedDecrypted } = makeConnectionsMock();
    const ctrl = new AudioController(svc, connections);
    const out = await ctrl.transcriptions(makeUser(), makeFile() as never, {
      connectionId: "conn-1",
      task: "transcribe",
    });
    expect(out).toEqual({ success: true, text: "hi", latencyMs: 5 });
    expect(getOwnedDecrypted).toHaveBeenCalledWith("user-1", "conn-1");
    expect(runTranscriptions).toHaveBeenCalledOnce();
    const [conn, arg] = runTranscriptions.mock.calls[0];
    expect(conn.id).toBe("conn-1");
    expect(arg.file.originalname).toBe("audio.wav");
    expect(arg.body.task).toBe("transcribe");
  });
});

describe("AudioController.tts", () => {
  it("delegates body to svc.runTts with resolved conn", async () => {
    const runTts = vi
      .fn()
      .mockResolvedValue({ success: true, audioBase64: "b", format: "mp3", latencyMs: 1 });
    const svc = { runTts } as unknown as AudioService;
    const { mock: connections, getOwnedDecrypted } = makeConnectionsMock();
    const ctrl = new AudioController(svc, connections);
    const out = await ctrl.tts(makeUser(), {
      connectionId: "conn-1",
      input: "hi",
      voice: "alloy",
      format: "mp3",
    });
    expect(out.success).toBe(true);
    expect(getOwnedDecrypted).toHaveBeenCalledWith("user-1", "conn-1");
    expect(runTts).toHaveBeenCalledOnce();
    const [conn, body] = runTts.mock.calls[0];
    expect(conn.id).toBe("conn-1");
    expect(body.input).toBe("hi");
  });

  it("throws 400 when reference_audio_base64 decoded bytes exceed 15 MB", async () => {
    const svc = { runTts: vi.fn() } as unknown as AudioService;
    const { mock: connections, getOwnedDecrypted } = makeConnectionsMock();
    const ctrl = new AudioController(svc, connections);
    // 15 MB + 1 byte decoded => base64 length ~ ceil((15*1024*1024+1) / 3) * 4
    const bigB64 = "A".repeat(Math.ceil((15 * 1024 * 1024 + 1) / 0.75));
    const fakeDataUrl = `data:audio/wav;base64,${bigB64}`;
    await expect(() =>
      ctrl.tts(makeUser(), {
        connectionId: "conn-1",
        input: "hi",
        voice: "alloy",
        format: "wav",
        reference_audio_base64: fakeDataUrl,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(svc.runTts).not.toHaveBeenCalled();
    expect(getOwnedDecrypted).not.toHaveBeenCalled();
  });

  it("accepts reference_audio_base64 within 15 MB and passes through", async () => {
    const runTts = vi
      .fn()
      .mockResolvedValue({ success: true, audioBase64: "b", format: "mp3", latencyMs: 1 });
    const svc = { runTts } as unknown as AudioService;
    const { mock: connections } = makeConnectionsMock();
    const ctrl = new AudioController(svc, connections);
    const smallDataUrl = "data:audio/wav;base64,UklGRgAAAA==";
    await ctrl.tts(makeUser(), {
      connectionId: "conn-1",
      input: "hi",
      voice: "alloy",
      format: "wav",
      reference_audio_base64: smallDataUrl,
      reference_text: "hi there",
    });
    expect(runTts).toHaveBeenCalledOnce();
    const [, body] = runTts.mock.calls[0] as [
      DecryptedConnection,
      { reference_audio_base64?: string; reference_text?: string },
    ];
    expect(body.reference_audio_base64).toBe(smallDataUrl);
    expect(body.reference_text).toBe("hi there");
  });
});
