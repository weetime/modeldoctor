-- CreateIndex
CREATE INDEX "baselines_template_id_idx" ON "baselines"("template_id");

-- AddForeignKey
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "benchmark_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
