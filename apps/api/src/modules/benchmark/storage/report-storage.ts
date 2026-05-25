/**
 * Report-side read interface for shared object storage (MinIO / S3).
 *
 * Phase 2 of #237: API only reads — runner writes via boto3 directly.
 * Implementations: S3ReportStorage (prod / dev), in-memory mock (tests).
 *
 * Throws when the network round-trip fails or auth is rejected.
 * Returns `false` from exists() when the object is genuinely absent.
 */
export interface ReportStorage {
  exists(key: string): Promise<boolean>;
  readJson<T>(key: string): Promise<T>;
  readText(key: string): Promise<string>;
  readBytes(key: string): Promise<Buffer>;
}

export const REPORT_STORAGE = Symbol("REPORT_STORAGE");
