-- CreateIndex
CREATE INDEX "automation_runs_status_source_id_idx" ON "automation_runs"("status", "source_id");
