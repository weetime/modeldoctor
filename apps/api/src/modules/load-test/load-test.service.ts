import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  ListLoadTestRunsQuery,
  ListLoadTestRunsResponse,
  LoadTestParsed,
  LoadTestRequest,
  LoadTestResponse,
  LoadTestRunSummary,
} from "@modeldoctor/contracts";
import { loadTestApiTypePath } from "@modeldoctor/contracts";
import { Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import { Prisma, type Run as PrismaRun } from "@prisma/client";
import {
  type ApiType,
  VALID_API_TYPES,
  buildRequestBody,
} from "../../integrations/builders/index.js";
import { type VegetaParsed, parseVegetaReport } from "../../integrations/parsers/vegeta-report.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import type { DecryptedConnection } from "../connection/connection.service.js";
import { RunRepository } from "../run/run.repository.js";

const TMP_DIR = path.resolve(__dirname, "../../../../..", "tmp");

function narrowParsed(v: VegetaParsed): LoadTestParsed {
  return {
    requests: v.requests,
    success: v.success,
    throughput: v.throughput,
    latencies: {
      mean: v.latencies.mean,
      p50: v.latencies.p50,
      p95: v.latencies.p95,
      p99: v.latencies.p99,
      max: v.latencies.max,
    },
  };
}

function runRowToLoadTestSummary(row: PrismaRun): LoadTestRunSummary {
  const scenario = (row.scenario ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    userId: row.userId,
    apiType: (scenario.apiType as LoadTestRunSummary["apiType"]) ?? "chat",
    apiBaseUrl: (scenario.apiBaseUrl as string) ?? "",
    model: (scenario.model as string) ?? "",
    rate: (scenario.rate as number) ?? 0,
    duration: (scenario.duration as number) ?? 0,
    status: row.status as "completed" | "failed",
    summaryJson: (row.summaryMetrics ?? null) as LoadTestParsed | null,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class LoadTestService {
  private readonly logger = new Logger(LoadTestService.name);

  constructor(private readonly runs: RunRepository) {}

  async run(
    conn: DecryptedConnection,
    req: LoadTestRequest,
    user: JwtPayload,
  ): Promise<LoadTestResponse> {
    const apiType = (VALID_API_TYPES as readonly string[]).includes(req.apiType ?? "")
      ? (req.apiType as ApiType)
      : "chat";

    let requestBody: Record<string, unknown>;
    try {
      requestBody = buildRequestBody(apiType, { ...req, model: conn.model });
    } catch (e) {
      throw new InternalServerErrorException(e instanceof Error ? e.message : String(e));
    }

    await fs.mkdir(TMP_DIR, { recursive: true });
    const jsonPath = path.join(TMP_DIR, "request.json");
    const txtPath = path.join(TMP_DIR, "request.txt");
    await fs.writeFile(jsonPath, JSON.stringify(requestBody, null, 2));

    let finalUrl = conn.baseUrl + loadTestApiTypePath(apiType);
    if (conn.queryParams?.trim()) {
      const params = conn.queryParams
        .split("\n")
        .map((p) => p.trim())
        .filter((p) => p.length > 0 && p.includes("="));
      if (params.length > 0) {
        const sep = finalUrl.includes("?") ? "&" : "?";
        finalUrl = finalUrl + sep + params.join("&");
      }
    }

    let extraHeaders = "";
    if (conn.customHeaders?.trim()) {
      const lines = conn.customHeaders
        .split("\n")
        .map((h) => h.trim())
        .filter((h) => h.length > 0 && h.includes(":"));
      extraHeaders = lines.map((h) => `\n${h}`).join("");
    }

    const txt = `POST ${finalUrl}
Content-Type: application/json
Authorization: Bearer ${conn.apiKey}${extraHeaders}
@${jsonPath}`;
    await fs.writeFile(txtPath, txt);

    const cmd = `cat ${txtPath} | vegeta attack -rate=${req.rate} -duration=${req.duration}s | vegeta report`;
    const timeoutMs = (req.duration + 60) * 1000;

    const scenario = {
      userId: user.sub,
      apiType,
      apiBaseUrl: conn.baseUrl,
      model: conn.model,
      rate: req.rate,
      duration: req.duration,
    };

    let stdout: string;
    try {
      stdout = await new Promise<string>((resolve, reject) => {
        const child = spawn(cmd, {
          cwd: TMP_DIR,
          shell: true,
          timeout: timeoutMs,
        });
        let out = "";
        let err = "";
        child.stdout?.on("data", (d: Buffer) => {
          out += d.toString();
        });
        child.stderr?.on("data", (d: Buffer) => {
          err += d.toString();
        });
        child.on("close", (code: number | null) => {
          if (code === 0) resolve(out);
          else reject(new Error(`vegeta exited ${code}: ${err || out}`));
        });
        child.on("error", (e: Error) => reject(e));
      });
    } catch (err) {
      // Best-effort persistence on failure — swallowing a Prisma error here
      // would hide the original vegeta failure the caller cares about.
      try {
        const failedRun = await this.runs.create({
          userId: user.sub,
          kind: "benchmark",
          tool: "vegeta",
          mode: "fixed",
          driverKind: "local",
          scenario: scenario as Prisma.InputJsonValue,
          params: req as unknown as Prisma.InputJsonValue,
        });
        await this.runs.update(failedRun.id, {
          status: "failed",
          rawOutput: {
            vegetaText: err instanceof Error ? err.message : String(err),
          } as Prisma.InputJsonValue,
          completedAt: new Date(),
        });
      } catch (dbErr) {
        this.logger.error(
          { dbErr, vegetaErr: err },
          "Failed to persist LoadTestRun failure row; rethrowing original error",
        );
      }
      throw err;
    }

    const parsed = narrowParsed(parseVegetaReport(stdout));
    const run = await this.runs.create({
      userId: user.sub,
      kind: "benchmark",
      tool: "vegeta",
      mode: "fixed",
      driverKind: "local",
      scenario: scenario as Prisma.InputJsonValue,
      params: req as unknown as Prisma.InputJsonValue,
    });

    // Update with results
    await this.runs.update(run.id, {
      status: "completed",
      summaryMetrics: parsed as unknown as Prisma.InputJsonValue,
      rawOutput: { vegetaText: stdout } as Prisma.InputJsonValue,
      completedAt: new Date(),
    });

    return {
      success: true,
      runId: run.id,
      report: stdout,
      parsed,
      config: {
        apiType,
        apiBaseUrl: conn.baseUrl,
        model: conn.model,
        rate: req.rate,
        duration: req.duration,
      },
    };
  }

  async listRuns(
    query: ListLoadTestRunsQuery,
    user: JwtPayload,
  ): Promise<ListLoadTestRunsResponse> {
    const limit = query.limit;
    const userId = user.roles.includes("admin") ? undefined : user.sub;
    const result = await this.runs.list({
      kind: "benchmark",
      tool: "vegeta",
      userId,
      cursor: query.cursor,
      limit,
    });

    const pageRows = result.items;
    const items = pageRows.map(runRowToLoadTestSummary);
    return { items, nextCursor: result.nextCursor };
  }
}
