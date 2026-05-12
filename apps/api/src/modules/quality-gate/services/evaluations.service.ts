import {
  type CreateEvaluationRequest,
  type Evaluation,
  type EvaluationSample,
  type ImportEvaluationRequest,
  type UpdateEvaluationRequest,
  evaluationSampleSchema,
  judgeConfigSchema,
} from "@modeldoctor/contracts";
import { Injectable } from "@nestjs/common";
import { customAlphabet } from "nanoid";
import type { EvaluationsRepository } from "../repositories/evaluations.repository.js";

const newSampleId = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 12);

@Injectable()
export class EvaluationsService {
  constructor(private readonly repo: EvaluationsRepository) {}

  list(userId: string) {
    return this.repo.list(userId);
  }
  get(userId: string, id: string) {
    return this.repo.findById(userId, id);
  }
  create(userId: string, body: CreateEvaluationRequest) {
    return this.repo.create(userId, this.normalize(body));
  }
  update(userId: string, id: string, body: UpdateEvaluationRequest) {
    const normalized: UpdateEvaluationRequest = body.samples
      ? { ...body, samples: this.assignIds(body.samples) }
      : body;
    return this.repo.update(userId, id, normalized);
  }
  delete(userId: string, id: string) {
    return this.repo.delete(userId, id);
  }

  async import(userId: string, name: string, body: ImportEvaluationRequest): Promise<Evaluation> {
    const samples = body.format === "csv" ? await this.parseCsv(body.payload) : body.payload;
    return this.create(userId, { name, samples });
  }

  async parseCsv(csv: string): Promise<EvaluationSample[]> {
    const rows = this.parseCsvRows(csv);
    if (rows.length < 2) throw new Error("CSV requires at least a header and one data row");
    const header = rows[0].map((h) => h.trim());
    const idx = (k: string) => header.findIndex((h) => h.toLowerCase() === k.toLowerCase());
    const ip = idx("prompt");
    const ie = idx("expected");
    const ik = idx("judgeKind");
    const ic = idx("judgeConfig");
    const it = idx("tags");
    if (ip < 0 || ie < 0 || ik < 0)
      throw new Error(
        "CSV must include columns: prompt, expected, judgeKind (judgeConfig and tags optional)",
      );

    const out: EvaluationSample[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const kind = row[ik]?.trim();
      const cfgRaw = ic >= 0 ? row[ic] : "";
      let cfg: unknown;
      if (cfgRaw && cfgRaw.trim().length > 0) {
        try {
          cfg = JSON.parse(cfgRaw);
        } catch {
          throw new Error(`row ${i}: judgeConfig is not valid JSON`);
        }
      } else {
        cfg = { kind };
      }
      const judgeConfig = judgeConfigSchema.parse({
        ...((cfg as object) || {}),
        kind: (cfg as { kind?: string }).kind ?? kind,
      });
      const sample = evaluationSampleSchema.parse({
        id: newSampleId(),
        idx: i - 1,
        prompt: row[ip] ?? "",
        expected: row[ie] ?? "",
        judgeConfig,
        tags:
          it >= 0 && row[it]
            ? row[it]
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean)
            : undefined,
      });
      out.push(sample);
    }
    return out;
  }

  // RFC-4180 CSV parser: handles quoted fields with embedded commas/newlines and "" escapes.
  private parseCsvRows(csv: string): string[][] {
    const rows: string[][] = [];
    let cur = "";
    let row: string[] = [];
    let inQ = false;
    const finishRow = () => {
      row.push(cur);
      cur = "";
      // Skip rows that are entirely empty (e.g. trailing newline).
      if (row.length > 1 || row[0].length > 0) rows.push(row);
      row = [];
    };
    for (let i = 0; i < csv.length; i++) {
      const ch = csv[i];
      if (inQ) {
        if (ch === '"' && csv[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          inQ = false;
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQ = true;
      } else if (ch === ",") {
        row.push(cur);
        cur = "";
      } else if (ch === "\r" || ch === "\n") {
        if (ch === "\r" && csv[i + 1] === "\n") i++;
        finishRow();
      } else {
        cur += ch;
      }
    }
    if (cur.length > 0 || row.length > 0) finishRow();
    return rows;
  }

  private normalize(body: CreateEvaluationRequest): CreateEvaluationRequest {
    return { ...body, samples: this.assignIds(body.samples) };
  }

  private assignIds(samples: EvaluationSample[]): EvaluationSample[] {
    return samples.map((s, i) => ({ ...s, id: s.id || newSampleId(), idx: i }));
  }
}
