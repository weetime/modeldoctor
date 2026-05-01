-- AlterTable
ALTER TABLE "connections" DROP COLUMN "api_type",
DROP COLUMN "prometheus_url",
DROP COLUMN "server_kind",
ADD COLUMN     "api_key_cipher" TEXT NOT NULL,
ADD COLUMN     "category" TEXT NOT NULL,
ADD COLUMN     "custom_headers" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "model" TEXT NOT NULL,
ADD COLUMN     "query_params" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "runs" DROP COLUMN "api_key_cipher";

-- CreateIndex
CREATE UNIQUE INDEX "connections_user_id_name_key" ON "connections"("user_id", "name");
