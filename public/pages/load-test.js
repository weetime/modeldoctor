// Load test page: form submit, loading indicator, results rendering, history.

import { readApiConfig, readTypeParams } from "./shared-config.js";

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function buildConfig() {
  const base = readApiConfig();
  const form = document.getElementById("loadTestForm");
  const formData = new FormData(form);
  return {
    ...base,
    ...readTypeParams(base.apiType),
    rate: parseInt(formData.get("rate")),
    duration: parseInt(formData.get("duration")),
  };
}

function validateForm(config) {
  if (!config.apiUrl || !config.apiKey || !config.model) {
    alert("Please fill in all required fields (marked with *)");
    return false;
  }
  try {
    new URL(config.apiUrl);
  } catch {
    alert("Invalid API URL format");
    return false;
  }
  if (config.apiType === "chat" && !config.prompt) {
    alert("Please enter a user prompt");
    return false;
  }
  if (config.apiType === "embeddings" && !config.embeddingInput) {
    alert("Please enter input text for embeddings");
    return false;
  }
  if (config.apiType === "rerank" && (!config.rerankQuery || !config.rerankTexts)) {
    alert("Please enter both query and texts for rerank");
    return false;
  }
  if (config.apiType === "images" && !config.imagePrompt) {
    alert("Please enter a prompt for image generation");
    return false;
  }
  if (config.apiType === "chat-vision" && (!config.prompt || !config.imageUrl)) {
    alert("Please enter both an image URL and a prompt for vision chat");
    return false;
  }
  if (config.apiType === "chat-audio" && !config.prompt) {
    alert("Please enter a prompt for audio-output chat");
    return false;
  }
  if (config.rate < 1 || config.rate > 10000) {
    alert("QPS must be between 1 and 10000");
    return false;
  }
  if (config.duration < 1 || config.duration > 3600) {
    alert("Duration must be between 1 and 3600 seconds");
    return false;
  }
  return true;
}

function showLoading(config) {
  const loading = document.getElementById("loadingIndicator");
  const details = document.getElementById("loadingDetails");
  const startBtn = document.getElementById("startBtn");
  loading.style.display = "block";
  startBtn.disabled = true;

  const totalRequests = config.rate * config.duration;
  const typeLabels = {
    chat: "Chat Completion",
    embeddings: "Embeddings",
    rerank: "Rerank",
    images: "Image Generation",
    "chat-vision": "Chat · Vision",
    "chat-audio": "Chat · Audio Output",
  };
  const lines = [
    `API Type: ${typeLabels[config.apiType] || config.apiType}`,
    `Testing at ${config.rate} req/s for ${config.duration} seconds`,
    `Expected total: ~${totalRequests} requests`,
    `Estimated time: ${formatDuration(config.duration)}`,
  ];
  details.innerHTML = lines.map(escapeHtml).join("<br>");
}

function hideLoading() {
  document.getElementById("loadingIndicator").style.display = "none";
  document.getElementById("startBtn").disabled = false;
}

function displayKeyMetrics(parsed) {
  const keyMetrics = document.getElementById("keyMetrics");
  const metrics = [
    { label: "Total Requests", value: parsed.requests || "N/A", unit: "" },
    { label: "Success Rate", value: parsed.success !== null ? parsed.success.toFixed(2) : "N/A", unit: "%" },
    { label: "Throughput", value: parsed.throughput !== null ? parsed.throughput.toFixed(2) : "N/A", unit: "req/s" },
    { label: "Mean Latency", value: parsed.latencies.mean || "N/A", unit: "" },
    { label: "P50 Latency", value: parsed.latencies.p50 || "N/A", unit: "" },
    { label: "P95 Latency", value: parsed.latencies.p95 || "N/A", unit: "" },
    { label: "P99 Latency", value: parsed.latencies.p99 || "N/A", unit: "" },
    { label: "Max Latency", value: parsed.latencies.max || "N/A", unit: "" },
  ];
  keyMetrics.innerHTML = metrics
    .map(
      (m) => `
        <div class="metric-card">
            <div class="metric-label">${escapeHtml(m.label)}</div>
            <div class="metric-value">
                ${escapeHtml(String(m.value))}
                <span class="metric-unit">${escapeHtml(m.unit)}</span>
            </div>
        </div>`,
    )
    .join("");
}

function displayResults(result) {
  const section = document.getElementById("resultsSection");
  const statusMessage = document.getElementById("statusMessage");
  const rawReport = document.getElementById("rawReport");
  const testConfig = document.getElementById("testConfig");

  section.style.display = "block";
  statusMessage.className = "status-message success";
  statusMessage.textContent = "✅ Load test completed successfully!";
  displayKeyMetrics(result.parsed);
  rawReport.textContent = result.report;
  testConfig.textContent = JSON.stringify(result.config, null, 2);
  section.scrollIntoView({ behavior: "smooth", block: "start" });
}

function displayError(err) {
  const section = document.getElementById("resultsSection");
  const statusMessage = document.getElementById("statusMessage");
  section.style.display = "block";
  statusMessage.className = "status-message error";
  statusMessage.textContent = `❌ Error: ${err}`;
  document.getElementById("keyMetrics").innerHTML = "";
  document.getElementById("rawReport").textContent = "No report available due to error.";
  document.getElementById("testConfig").textContent = "";
  section.scrollIntoView({ behavior: "smooth", block: "start" });
}

function saveToHistory(config) {
  try {
    const history = JSON.parse(localStorage.getItem("testHistory") || "[]");
    history.unshift({ ...config, timestamp: new Date().toISOString() });
    if (history.length > 10) history.pop();
    localStorage.setItem("testHistory", JSON.stringify(history));
  } catch (e) {
    console.error("Failed to save history:", e);
  }
}

export function initLoadTest() {
  const form = document.getElementById("loadTestForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const config = buildConfig();
    if (!validateForm(config)) return;

    showLoading(config);
    document.getElementById("resultsSection").style.display = "none";

    try {
      const response = await fetch("/api/load-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const result = await response.json();
      hideLoading();
      if (result.success) {
        displayResults(result);
        saveToHistory(config);
      } else {
        displayError(result.error);
      }
    } catch (err) {
      hideLoading();
      displayError(`Network error: ${err.message}`);
    }
  });

  const resetBtn = document.getElementById("resetBtn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      if (confirm("Are you sure you want to reset all fields?")) {
        form.reset();
        document.getElementById("resultsSection").style.display = "none";
        const apiTypeSelect = document.getElementById("apiType");
        apiTypeSelect.value = "chat";
        apiTypeSelect.dispatchEvent(new Event("change"));
      }
    });
  }
}
