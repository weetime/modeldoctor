// E2E Smoke tab: runs 1 or all probes against the shared API config.
// Each probe lives in a card; results render inline (PASS/FAIL + checks + inline audio/image).

import { readApiConfig } from "./shared-config.js";

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function setCardState(probeName, state /* 'idle' | 'running' | 'pass' | 'fail' */) {
  const card = document.getElementById(`e2eCard-${probeName}`);
  if (!card) return;
  card.classList.remove("running", "pass", "fail");
  const statusEl = card.querySelector("[data-status]");
  statusEl.classList.remove("running", "pass", "fail");
  if (state === "idle") {
    statusEl.textContent = "—";
    statusEl.className = "e2e-status";
    card.querySelector("[data-output]").innerHTML = "";
    return;
  }
  card.classList.add(state);
  statusEl.classList.add(state);
  statusEl.textContent = state === "running" ? "…" : state.toUpperCase();
}

function renderChecks(checks) {
  return `<ul class="checks">${checks
    .map(
      (c) =>
        `<li class="${c.pass ? "ok" : "bad"}">${escapeHtml(c.name)}${
          c.info ? ` <span class="meta">(${escapeHtml(String(c.info))})</span>` : ""
        }</li>`,
    )
    .join("")}</ul>`;
}

function renderProbeResult(probeName, result) {
  const card = document.getElementById(`e2eCard-${probeName}`);
  if (!card) return;
  const out = card.querySelector("[data-output]");
  const det = result.details || {};

  const parts = [];
  parts.push(
    `<div class="meta">latency: ${result.latencyMs ?? "—"} ms</div>`,
  );
  parts.push(renderChecks(result.checks || []));

  if (probeName === "text" && det.content) {
    parts.push(`<div class="content-line">${escapeHtml(det.content)}</div>`);
    if (det.usage) {
      parts.push(
        `<div class="meta">tokens — prompt: ${det.usage.prompt_tokens}, completion: ${det.usage.completion_tokens}</div>`,
      );
    }
  }

  if (probeName === "image") {
    if (det.imagePreviewB64) {
      const mime = det.imageMime || "image/png";
      parts.push(
        `<div><img class="preview" alt="probe input" src="data:${mime};base64,${det.imagePreviewB64}"></div>`,
      );
    }
    if (det.content) parts.push(`<div class="content-line">${escapeHtml(det.content)}</div>`);
  }

  if (probeName === "audio") {
    if (det.audioB64) {
      parts.push(
        `<audio controls src="data:audio/wav;base64,${det.audioB64}"></audio>`,
        `<div class="meta">${det.audioBytes} bytes, ${det.numChoices} choice(s)${
          det.textReply ? ", text: " + escapeHtml(det.textReply) : ""
        }</div>`,
      );
    }
  }

  out.innerHTML = parts.join("");
}

async function runProbes(probeNames) {
  const base = readApiConfig();
  if (!base.apiUrl || !base.apiKey || !base.model) {
    alert("Please fill API URL, API Key and Model above.");
    return;
  }

  for (const n of probeNames) setCardState(n, "running");

  try {
    const res = await fetch("/api/e2e-test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiUrl: base.apiUrl,
        apiKey: base.apiKey,
        model: base.model,
        customHeaders: base.customHeaders,
        probes: probeNames,
      }),
    });
    const data = await res.json();
    if (!data.success) {
      for (const n of probeNames) {
        setCardState(n, "fail");
        const card = document.getElementById(`e2eCard-${n}`);
        card.querySelector("[data-output]").innerHTML =
          `<div class="content-line">${escapeHtml(data.error || "Unknown error")}</div>`;
      }
      return;
    }
    for (const r of data.results) {
      setCardState(r.probe, r.pass ? "pass" : "fail");
      renderProbeResult(r.probe, r);
    }
  } catch (err) {
    for (const n of probeNames) {
      setCardState(n, "fail");
      const card = document.getElementById(`e2eCard-${n}`);
      card.querySelector("[data-output]").innerHTML =
        `<div class="content-line">Network error: ${escapeHtml(err.message)}</div>`;
    }
  }
}

function initTabs() {
  const buttons = document.querySelectorAll(".tab-btn");
  const panels = document.querySelectorAll(".tab-panel");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.toggle("active", b === btn));
      panels.forEach((p) => {
        const on = p.id === `panel-${btn.dataset.tab}`;
        p.classList.toggle("active", on);
        p.hidden = !on;
      });
    });
  });
}

export function initE2ETest() {
  initTabs();

  document.querySelectorAll("[data-run-probe]").forEach((btn) => {
    btn.addEventListener("click", () => runProbes([btn.dataset.runProbe]));
  });

  const runAll = document.getElementById("runAllE2E");
  if (runAll) runAll.addEventListener("click", () => runProbes(["text", "image", "audio"]));

  const reset = document.getElementById("resetE2E");
  if (reset) {
    reset.addEventListener("click", () => {
      for (const n of ["text", "image", "audio"]) setCardState(n, "idle");
    });
  }
}
