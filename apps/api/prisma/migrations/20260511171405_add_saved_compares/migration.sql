-- CreateTable
CREATE TABLE "saved_compares" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "benchmark_ids" TEXT[],
    "stage_labels" JSONB NOT NULL,
    "baseline_id" TEXT,
    "context" TEXT,
    "narrative" JSONB,
    "narrative_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "saved_compares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_compares_user_id_created_at_idx" ON "saved_compares"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "saved_compares" ADD CONSTRAINT "saved_compares_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
