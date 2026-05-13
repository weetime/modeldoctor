-- AlterTable
ALTER TABLE "evaluations" ADD COLUMN     "is_official" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "evaluations_is_official_idx" ON "evaluations"("is_official");
