import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  ListLoadTestRunsQuery,
  ListLoadTestRunsResponse,
  LoadTestParsed,
  LoadTestRequest,
  LoadTestResponse,
} from "@modeldoctor/contracts";
import { Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service.js";
import {
  type ApiType,
  VALID_API_TYPES,
  buildRequestBody,
} from "../../integrations/builders/index.js";
import { type VegetaParsed, parseVegetaReport } from "../../integrations/parsers/vegeta-report.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";

const TMP_DIR = path.resolve(process.cwd(), "tmp");

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

@Injectable()
export class LoadTestService {
  private readonly logger = new Logger(LoadTestService.name);

  constructor(private readonly prisma: PrismaService) {}

  async run(req: LoadTestRequest, user: JwtPayload): Promise<LoadTestResponse> {
    const apiType = (VALID_API_TYPES as readonly string[]).includes(req.apiType ?? "")
      ? (req.apiType as ApiType)
      : "chat";

    let requestBody: Record<string, unknown>;
    try {
      requestBody = buildRequestBody(apiType, { ...req, model: req.model });
    } catch (e) {
      throw new InternalServerErrorException(e instanceof Error ? e.message : String(e));
    }

    await fs.mkdir(TMP_DIR, { recursive: true });
    const jsonPath = path.join(TMP_DIR, "request.json");
    const txtPath = path.join(TMP_DIR, "request.txt");
    await fs.writeFile(jsonPath, JSON.stringify(requestBody, null, 2));

    let finalUrl = req.apiUrl;
    if (req.queryParams?.trim()) {
      const params = req.queryParams
        .split("\n")
        .map((p) => p.trim())
        .filter((p) => p.length > 0 && p.includes("="));
      if (params.length > 0) {
        const sep = finalUrl.includes("?") ? "&" : "?";
        finalUrl = finalUrl + sep + params.join("&");
      }
    }

    let extraHeaders = "";
    if (req.customHeaders?.trim()) {
      const lines = req.customHeaders
        .split("\n")
        .map((h) => h.trim())
        .filter((h) => h.length > 0 && h.includes(":"));
      extraHeaders = lines.map((h) => `\n${h}`).join("");
    }

    const txt = `POST ${finalUrl}
Content-Type: application/json
Authorization: Bearer ${req.apiKey}${extraHeaders}
@${jsonPath}`;
    await fs.writeFile(txtPath, txt);

    const cmd = `cat ${txtPath} | vegeta attack -rate=${req.rate} -duration=${req.duration}s | vegeta report`;
    const timeoutMs = (req.duration + 60) * 1000;

    const baseRow = {
      userId: user.sub,
      apiType,
      apiUrl: finalUrl,
      model: req.model,
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
        await this.prisma.loadTestRun.create({
          data: {
            ...baseRow,
            status: "failed",
            summaryJson: {},
            rawReport: err instanceof Error ? err.message : String(err),
            completedAt: new Date(),
          },
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
    const run = await this.prisma.loadTestRun.create({
      data: {
        ...baseRow,
        status: "completed",
        summaryJson: parsed as unknown as object,
        rawReport: stdout,
        completedAt: new Date(),
      },
    });

    return {
      success: true,
      runId: run.id,
      report: stdout,
      parsed,
      config: {
        apiType,
        apiUrl: finalUrl,
        model: req.model,
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
    const whereUser = user.roles.includes("admin") ? {} : { userId: user.sub };
    const rows = await this.prisma.loadTestRun.findMany({
      take: limit + 1, // peek one past to detect a next page
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      where: whereUser,
      // id tiebreaker keeps cursor semantics stable if two rows share createdAt
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const pageRows = rows.slice(0, limit);
    const items = pageRows.map((r) => ({
      id: r.id,
      userId: r.userId,
      apiType: r.apiType as ApiType,
      apiUrl: r.apiUrl,
      model: r.model,
      rate: r.rate,
      duration: r.duration,
      status: r.status as "completed" | "failed",
      summaryJson: (r.summaryJson ?? null) as LoadTestParsed | null,
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
    }));
    const nextCursor = rows.length > limit ? pageRows[pageRows.length - 1].id : null;
    return { items, nextCursor };
  }
}
