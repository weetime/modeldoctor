const express = require("express");
const { runTextProbe } = require("../probes/text");
const { runImageProbe } = require("../probes/image");
const { runAudioProbe } = require("../probes/audio");

const router = express.Router();

const PROBES = {
  text: runTextProbe,
  image: runImageProbe,
  audio: runAudioProbe,
};

function parseHeaderLines(s) {
  const out = {};
  if (!s || !s.trim()) return out;
  for (const line of s.split("\n").map((l) => l.trim())) {
    if (!line || !line.includes(":")) continue;
    const idx = line.indexOf(":");
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

/**
 * POST /api/e2e-test
 * Body: { apiUrl, apiKey, model, customHeaders?, probes: ["text","image","audio"] }
 * Runs requested probes in parallel, returns array of { probe, pass, latencyMs, checks, details }.
 */
router.post("/e2e-test", async (req, res) => {
  const { apiUrl, apiKey, model, customHeaders, probes } = req.body;

  if (!apiUrl || !apiKey || !model) {
    return res.status(400).json({
      success: false,
      error: "Missing required parameters (apiUrl, apiKey, model)",
    });
  }
  if (!Array.isArray(probes) || probes.length === 0) {
    return res.status(400).json({
      success: false,
      error: "probes must be a non-empty array, e.g. [\"text\",\"image\",\"audio\"]",
    });
  }

  const unknown = probes.filter((p) => !(p in PROBES));
  if (unknown.length) {
    return res.status(400).json({
      success: false,
      error: `Unknown probes: ${unknown.join(", ")}. Valid: ${Object.keys(PROBES).join(", ")}`,
    });
  }

  const extraHeaders = parseHeaderLines(customHeaders);
  const ctx = { apiUrl, apiKey, model, extraHeaders };

  const results = await Promise.all(
    probes.map(async (name) => {
      try {
        const r = await PROBES[name](ctx);
        return { probe: name, ...r };
      } catch (e) {
        return {
          probe: name,
          pass: false,
          latencyMs: null,
          checks: [{ name: "probe execution", pass: false, info: e.message }],
          details: { error: e.message },
        };
      }
    }),
  );

  res.json({
    success: true,
    allPassed: results.every((r) => r.pass),
    results,
  });
});

module.exports = router;
