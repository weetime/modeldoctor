#!/usr/bin/env bash
# Send a mock Alertmanager v4 webhook payload to a running ModelDoctor API.
#
# Usage:
#   ALERTMANAGER_WEBHOOK_SECRET=<32+ char secret> ./tools/send-mock-alert.sh [URL]
#
# Default URL: http://localhost:3001/api/alerts/webhook
# The payload mimics what the PR #190 PrometheusRule alert
# ModelDoctorKvCacheHigh would produce when KV cache > 85% for 5m.
set -euo pipefail

URL="${1:-http://localhost:3001/api/alerts/webhook}"
SECRET="${ALERTMANAGER_WEBHOOK_SECRET:?set ALERTMANAGER_WEBHOOK_SECRET to match the server}"

# Sample model_name — change to match a real Connection.model in your dev DB
# for the connection-inference lookup to succeed.
MODEL_NAME="${MODEL_NAME:-Qwen3-32B}"

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
FINGERPRINT="mock-kvcache-$(date +%s)"

PAYLOAD=$(cat <<JSON
{
  "version": "4",
  "groupKey": "{}:{alertname=\"ModelDoctorKvCacheHigh\"}",
  "alerts": [
    {
      "status": "firing",
      "labels": {
        "alertname": "ModelDoctorKvCacheHigh",
        "severity": "warning",
        "modeldoctor_scenario": "kv-cache-pressure",
        "model_name": "${MODEL_NAME}",
        "engine": "vllm-v1",
        "instance": "vllm-prod-7.cluster.local:8000"
      },
      "annotations": {
        "summary": "KV cache 91% on ${MODEL_NAME} (vllm-v1)",
        "description": "KV cache utilization at 0.91 sustained for 5m. New requests will start queueing; TTFT will degrade and preemptions may kick in."
      },
      "startsAt": "${NOW}",
      "generatorURL": "http://prometheus.example.com/graph",
      "fingerprint": "${FINGERPRINT}"
    }
  ]
}
JSON
)

echo "POST ${URL}"
echo "Fingerprint: ${FINGERPRINT}"
echo

curl -sS -X POST "${URL}" \
  -H "Authorization: Bearer ${SECRET}" \
  -H "Content-Type: application/json" \
  --data "${PAYLOAD}" \
  -w "\nHTTP %{http_code}\n"
