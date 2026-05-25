import { Readable } from "node:stream";
import { GetObjectCommand, HeadObjectCommand, NotFound, S3Client } from "@aws-sdk/client-s3";
import { Injectable } from "@nestjs/common";
import type { ReportStorage } from "./report-storage.js";

export interface S3ReportStorageConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

@Injectable()
export class S3ReportStorage implements ReportStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(cfg: S3ReportStorageConfig) {
    this.client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      forcePathStyle: true,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      maxAttempts: 2,
    });
    this.bucket = cfg.bucket;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (e) {
      // SDK v3 surfaces 404 as NotFound class instance OR { name: "NotFound" } depending on path
      if (e instanceof NotFound) return false;
      if ((e as { name?: string }).name === "NotFound") return false;
      throw e;
    }
  }

  async readJson<T>(key: string): Promise<T> {
    const text = await this.readText(key);
    return JSON.parse(text) as T;
  }

  async readText(key: string): Promise<string> {
    const buf = await this.readBytes(key);
    return buf.toString("utf8");
  }

  async readBytes(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`S3 GetObject ${key} returned empty body`);
    const stream = res.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream)
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  async readStream(key: string): Promise<Readable> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`S3 GetObject ${key} returned empty body`);
    return res.Body as Readable;
  }
}
