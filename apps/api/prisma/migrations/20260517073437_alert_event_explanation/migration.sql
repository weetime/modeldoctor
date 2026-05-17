-- CreateTable
CREATE TABLE "alert_events" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "scenario" TEXT,
    "alert_name" TEXT NOT NULL,
    "connection_id" TEXT,
    "model_name" TEXT,
    "engine" TEXT,
    "instance" TEXT,
    "labels" JSONB NOT NULL,
    "annotations" JSONB NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3),
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_explanations" (
    "id" TEXT NOT NULL,
    "alert_event_id" TEXT NOT NULL,
    "narrative" TEXT NOT NULL,
    "recommendations" JSONB NOT NULL,
    "ai_severity" TEXT NOT NULL,
    "llm_provider" TEXT NOT NULL,
    "llm_model" TEXT NOT NULL,
    "tokens_used" INTEGER,
    "latency_ms" INTEGER NOT NULL,
    "generated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_explanations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alert_events_connection_id_received_at_idx" ON "alert_events"("connection_id", "received_at");

-- CreateIndex
CREATE INDEX "alert_events_status_severity_received_at_idx" ON "alert_events"("status", "severity", "received_at");

-- CreateIndex
CREATE INDEX "alert_events_scenario_idx" ON "alert_events"("scenario");

-- CreateIndex
CREATE UNIQUE INDEX "alert_events_fingerprint_starts_at_key" ON "alert_events"("fingerprint", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "alert_explanations_alert_event_id_key" ON "alert_explanations"("alert_event_id");

-- AddForeignKey
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_explanations" ADD CONSTRAINT "alert_explanations_alert_event_id_fkey" FOREIGN KEY ("alert_event_id") REFERENCES "alert_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
