-- CreateTable
CREATE TABLE "mcp_servers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "transport" TEXT NOT NULL DEFAULT 'http',
    "url" TEXT NOT NULL,
    "auth_token_cipher" TEXT,
    "headers" TEXT NOT NULL DEFAULT '',
    "tools_cache" JSONB,
    "tools_cached_at" TIMESTAMPTZ(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "mcp_servers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mcp_servers_user_id_idx" ON "mcp_servers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_servers_user_id_name_key" ON "mcp_servers"("user_id", "name");

-- AddForeignKey
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
