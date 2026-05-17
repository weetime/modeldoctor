-- CreateTable
CREATE TABLE "connection_subscribers" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "min_severity" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "connection_subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "connection_subscribers_connection_id_idx" ON "connection_subscribers"("connection_id");

-- CreateIndex
CREATE INDEX "connection_subscribers_user_id_idx" ON "connection_subscribers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "connection_subscribers_connection_id_user_id_channel_id_key" ON "connection_subscribers"("connection_id", "user_id", "channel_id");

-- AddForeignKey
ALTER TABLE "connection_subscribers" ADD CONSTRAINT "connection_subscribers_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connection_subscribers" ADD CONSTRAINT "connection_subscribers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connection_subscribers" ADD CONSTRAINT "connection_subscribers_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "notification_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
