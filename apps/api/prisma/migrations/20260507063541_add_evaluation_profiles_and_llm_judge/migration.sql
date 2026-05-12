-- AlterTable
ALTER TABLE "connections" ADD COLUMN     "evaluation_profile_id" TEXT;

-- CreateTable
CREATE TABLE "evaluation_profiles" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT,
    "description" TEXT,
    "is_builtin" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT,
    "rules" JSONB NOT NULL,
    "source" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "evaluation_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_judge_providers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "api_key_cipher" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "llm_judge_providers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_profiles_slug_key" ON "evaluation_profiles"("slug");

-- CreateIndex
CREATE INDEX "evaluation_profiles_is_builtin_idx" ON "evaluation_profiles"("is_builtin");

-- CreateIndex
CREATE UNIQUE INDEX "llm_judge_providers_user_id_key" ON "llm_judge_providers"("user_id");

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_evaluation_profile_id_fkey" FOREIGN KEY ("evaluation_profile_id") REFERENCES "evaluation_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_profiles" ADD CONSTRAINT "evaluation_profiles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_judge_providers" ADD CONSTRAINT "llm_judge_providers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- NOTE: the 5 built-in evaluation_profiles that used to live here as
-- INSERT statements have moved to `apps/api/prisma/seed.ts`. They are
-- upserted idempotently after every `prisma migrate dev` /
-- `prisma migrate reset`. In prod, the deploy pipeline must run
-- `pnpm prisma db seed` after `prisma migrate deploy`. See seed.ts
-- header for the full pattern.
