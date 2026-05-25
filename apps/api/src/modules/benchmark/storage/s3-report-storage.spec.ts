import { Readable } from "node:stream";
import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { S3ReportStorage } from "./s3-report-storage.js";

const s3Mock = mockClient(S3Client);

function bodyFromString(s: string) {
  return Readable.from([Buffer.from(s, "utf8")]) as unknown as ReturnType<typeof Readable.from>;
}

function makeStorage() {
  return new S3ReportStorage({
    endpoint: "http://localhost:9999",
    region: "us-east-1",
    accessKeyId: "test",
    secretAccessKey: "test",
    bucket: "test-bucket",
  });
}

describe("S3ReportStorage", () => {
  beforeEach(() => s3Mock.reset());
  afterEach(() => s3Mock.reset());

  it("exists() returns true when HeadObject succeeds", async () => {
    s3Mock.on(HeadObjectCommand).resolves({});
    const storage = makeStorage();
    expect(await storage.exists("run-1/result.json")).toBe(true);
  });

  it("exists() returns false on NotFound", async () => {
    s3Mock
      .on(HeadObjectCommand)
      .rejects(Object.assign(new Error("not found"), { name: "NotFound" }));
    const storage = makeStorage();
    expect(await storage.exists("run-1/result.json")).toBe(false);
  });

  it("exists() rethrows on non-NotFound errors", async () => {
    s3Mock.on(HeadObjectCommand).rejects(new Error("network down"));
    const storage = makeStorage();
    await expect(storage.exists("run-1/result.json")).rejects.toThrow("network down");
  });

  it("readJson() parses GetObject body", async () => {
    s3Mock.on(GetObjectCommand).resolves({ Body: bodyFromString('{"exitCode":0}') as never });
    const storage = makeStorage();
    expect(await storage.readJson("run-1/result.json")).toEqual({ exitCode: 0 });
  });

  it("readText() returns full body as string", async () => {
    s3Mock.on(GetObjectCommand).resolves({ Body: bodyFromString("hello\nworld") as never });
    const storage = makeStorage();
    expect(await storage.readText("run-1/stdout.log")).toBe("hello\nworld");
  });

  it("readBytes() returns Buffer", async () => {
    s3Mock.on(GetObjectCommand).resolves({ Body: bodyFromString("binary") as never });
    const storage = makeStorage();
    expect((await storage.readBytes("run-1/files/x")).toString("utf8")).toBe("binary");
  });
});
