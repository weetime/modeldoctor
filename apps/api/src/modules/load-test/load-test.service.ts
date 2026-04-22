import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  LoadTestRequest,
  LoadTestResponse,
  LoadTestParsed,
} from "@modeldoctor/contracts";
import {
  buildRequestBody,
  VALID_API_TYPES,
  type ApiType,
} from "../../integrations/builders/index.js";
import {
  parseVegetaReport,
  type VegetaParsed,
} from "../../integrations/parsers/vegeta-report.js";

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
  async run(req: LoadTestRequest): Promise<LoadTestResponse> {
    const apiType = (VALID_API_TYPES as readonly string[]).includes(
      req.apiType ?? "",
    )
      ? (req.apiType as ApiType)
      : "chat";

    let requestBody: Record<string, unknown>;
    try {
      requestBody = buildRequestBody(apiType, { ...req, model: req.model });
    } catch (e) {
      throw new InternalServerErrorException(
        e instanceof Error ? e.message : String(e),
      );
    }

    await fs.mkdir(TMP_DIR, { recursive: true });
    const jsonPath = path.join(TMP_DIR, "request.json");
    const txtPath = path.join(TMP_DIR, "request.txt");
    await fs.writeFile(jsonPath, JSON.stringify(requestBody, null, 2));

    let finalUrl = req.apiUrl;
    if (req.queryParams && req.queryParams.trim()) {
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
    if (req.customHeaders && req.customHeaders.trim()) {
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

    const stdout = await new Promise<string>((resolve, reject) => {
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

    const parsed = narrowParsed(parseVegetaReport(stdout));
    return {
      success: true,
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
}
