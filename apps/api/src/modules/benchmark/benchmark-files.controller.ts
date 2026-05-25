import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import type { JwtPayload } from "../auth/jwt.strategy.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { BenchmarkRepository } from "./benchmark.repository.js";
import { REPORT_STORAGE, type ReportStorage } from "./storage/report-storage.js";

@ApiTags("benchmarks")
@Controller("benchmarks/:id/files")
@UseGuards(JwtAuthGuard)
export class BenchmarkFilesController {
  constructor(
    private readonly repo: BenchmarkRepository,
    @Inject(REPORT_STORAGE) private readonly storage: ReportStorage,
  ) {}

  @Get(":alias")
  @ApiOperation({ summary: "Stream an output file from the benchmark's S3 report" })
  async getFile(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Param("alias") alias: string,
  ): Promise<StreamableFile> {
    const bench = await this.repo.findById(id);
    if (!bench) throw new NotFoundException(`benchmark ${id} not found`);

    const isAdmin = user.roles.includes("admin");
    if (!isAdmin && bench.userId && bench.userId !== user.sub) {
      throw new ForbiddenException();
    }

    const files =
      ((bench.rawOutput as { files?: Record<string, string> } | null) ?? {}).files ?? {};
    const relPath = files[alias];
    if (!relPath) throw new NotFoundException(`alias ${alias} not in this benchmark's files`);

    const key = `${id}/${relPath}`;
    const bytes = await this.storage.readBytes(key);
    return new StreamableFile(bytes, { disposition: `attachment; filename="${alias}"` });
  }
}
