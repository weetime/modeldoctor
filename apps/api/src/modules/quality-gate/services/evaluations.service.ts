import {
  type CreateEvaluationRequest,
  type Evaluation,
  type EvaluationSample,
  type EvaluationSampleInput,
  type ImportEvaluationRequest,
  type UpdateEvaluationRequest,
  evaluationSampleSchema,
  judgeConfigSchema,
} from "@modeldoctor/contracts";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { customAlphabet } from "nanoid";
import { EvaluationsRepository } from "../repositories/evaluations.repository.js";
import { RunsRepository } from "../repositories/runs.repository.js";

const newSampleId = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 12);

@Injectable()
export class EvaluationsService {
  constructor(
    private readonly repo: EvaluationsRepository,
    private readonly runsRepo: RunsRepository,
  ) {}

  list(userId: string) {
    return this.repo.list(userId);
  }
  get(userId: string, id: string) {
    return this.repo.findById(userId, id);
  }
  create(userId: string, body: CreateEvaluationRequest) {
    return this.repo.create(userId, this.normalize(body));
  }
  async update(userId: string, id: string, body: UpdateEvaluationRequest) {
    const existing = await this.repo.findById(userId, id);
    if (!existing) throw new NotFoundException(`evaluation ${id} not found`);
    // Official (built-in) evaluations are fully read-only. baselineRunId
    // included: pins are eval-level (shared across all viewers), so allowing
    // one user to pin on a shared official eval would mutate other users'
    // view of the same row. To pin, users must duplicate first.
    if (existing.isOfficial) {
      throw new BadRequestException(
        `evaluation ${id} is official and read-only; duplicate it first to make changes`,
      );
    }
    const normalized: UpdateEvaluationRequest = body.samples
      ? { ...body, samples: this.assignIds(body.samples) }
      : body;
    return this.repo.update(userId, id, normalized);
  }
  async delete(userId: string, id: string) {
    const existing = await this.repo.findById(userId, id);
    if (!existing) throw new NotFoundException(`evaluation ${id} not found`);
    if (existing.isOfficial) {
      throw new BadRequestException(`evaluation ${id} is official and cannot be deleted`);
    }
    return this.repo.delete(userId, id);
  }

  /** Create a private copy of an evaluation (official or own) — samples and
   * description carry over, name gets a " (副本)" suffix, the new row is
   * owned by the caller and is NOT official. */
  async duplicate(userId: string, sourceId: string): Promise<Evaluation> {
    const source = await this.repo.findById(userId, sourceId);
    if (!source) throw new NotFoundException(`evaluation ${sourceId} not found`);
    return this.repo.create(userId, {
      name: `${source.name} (副本)`,
      description: source.description ?? undefined,
      samples: source.samples,
    });
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

  private assignIds(samples: EvaluationSampleInput[]): EvaluationSample[] {
    return samples.map((s, i) => ({ ...s, id: s.id || newSampleId(), idx: i }));
  }

  async setBaseline(userId: string, evaluationId: string, runId: string | null) {
    const evaluation = await this.repo.findById(userId, evaluationId);
    if (!evaluation) throw new NotFoundException(`evaluation ${evaluationId} not found`);

    // Official evaluations are read-only — pinning is row-level state shared
    // across all viewers, so allowing per-user pins on built-ins would leak
    // across users. Force a duplicate-first workflow.
    if (evaluation.isOfficial) {
      throw new BadRequestException(
        `evaluation ${evaluationId} is official; duplicate it first to pin a baseline`,
      );
    }

    if (runId !== null) {
      const run = await this.runsRepo.findById(userId, runId);
      if (!run) throw new NotFoundException(`run ${runId} not found`);
      if (run.evaluationId !== evaluationId) {
        throw new BadRequestException(`run ${runId} belongs to a different evaluation`);
      }
      if (run.status !== "COMPLETED") {
        throw new BadRequestException(`run ${runId} must be COMPLETED to be pinned as baseline`);
      }
      // Gate verdict (PASSED / WARNING / FAILED) intentionally not checked here.
      // Baseline is a user-chosen comparison reference, not a "known-good" marker —
      // industry mainstream (LangSmith / Braintrust / Vellum) lets users pin any
      // completed run, including ones that didn't meet the gate, so they can
      // track movement away from a known-broken state.
    }

    return this.repo.update(userId, evaluationId, { baselineRunId: runId });
  }
}
