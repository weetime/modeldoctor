const express = require("express");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const { buildRequestBody, VALID_API_TYPES } = require("../builders");
const { parseVegetaReport } = require("../parsers/vegeta-report");

const router = express.Router();

const TMP_DIR = path.join(__dirname, "..", "..", "tmp");

function ensureTmpDir() {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
}

/**
 * POST /api/load-test — runs a Vegeta attack and returns the parsed report.
 */
router.post("/load-test", (req, res) => {
  const {
    apiType,
    apiUrl,
    apiKey,
    model,
    customHeaders,
    queryParams,
    rate,
    duration,
  } = req.body;

  if (!apiUrl || !apiKey || !model) {
    return res.status(400).json({
      success: false,
      error: "Missing required parameters (apiUrl, apiKey, model)",
    });
  }

  const resolvedApiType = VALID_API_TYPES.includes(apiType) ? apiType : "chat";

  const sanitizedRate = parseInt(rate, 10);
  const sanitizedDuration = parseInt(duration, 10);

  if (!Number.isInteger(sanitizedRate) || sanitizedRate < 1 || sanitizedRate > 10000) {
    return res.status(400).json({
      success: false,
      error: "Invalid rate parameter. Must be an integer between 1 and 10000.",
    });
  }
  if (!Number.isInteger(sanitizedDuration) || sanitizedDuration < 1 || sanitizedDuration > 3600) {
    return res.status(400).json({
      success: false,
      error: "Invalid duration parameter. Must be an integer between 1 and 3600.",
    });
  }

  let requestBody;
  try {
    requestBody = buildRequestBody(resolvedApiType, { model, ...req.body });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }

  ensureTmpDir();
  const requestJsonPath = path.join(TMP_DIR, "request.json");
  const requestTxtPath = path.join(TMP_DIR, "request.txt");

  try {
    fs.writeFileSync(requestJsonPath, JSON.stringify(requestBody, null, 2));

    let finalUrl = apiUrl;
    if (queryParams && queryParams.trim()) {
      const params = queryParams
        .split("\n")
        .map((p) => p.trim())
        .filter((p) => p.length > 0 && p.includes("="));
      if (params.length > 0) {
        const separator = finalUrl.includes("?") ? "&" : "?";
        finalUrl = finalUrl + separator + params.join("&");
      }
    }

    let extraHeaders = "";
    if (customHeaders && customHeaders.trim()) {
      const headerLines = customHeaders
        .split("\n")
        .map((h) => h.trim())
        .filter((h) => h.length > 0 && h.includes(":"));
      extraHeaders = headerLines.map((h) => `\n${h}`).join("");
    }

    const requestTxt = `POST ${finalUrl}
Content-Type: application/json
Authorization: Bearer ${apiKey}${extraHeaders}
@${requestJsonPath}`;

    fs.writeFileSync(requestTxtPath, requestTxt);

    console.log("🚀 Starting load test:", {
      apiType: resolvedApiType,
      apiUrl: finalUrl,
      model,
      rate: sanitizedRate,
      duration: `${sanitizedDuration}s`,
    });

    const vegetaCmd = `cat ${requestTxtPath} | vegeta attack -rate=${sanitizedRate} -duration=${sanitizedDuration}s | vegeta report`;
    const timeoutMs = (sanitizedDuration + 60) * 1000;

    exec(
      vegetaCmd,
      { cwd: TMP_DIR, maxBuffer: 10 * 1024 * 1024, timeout: timeoutMs },
      (error, stdout, stderr) => {
        if (error) {
          console.error("❌ Vegeta execution error:", error);
          return res.status(500).json({
            success: false,
            error: error.message,
            stderr,
          });
        }
        if (stderr) console.warn("⚠️  Vegeta stderr:", stderr);

        const parsed = parseVegetaReport(stdout);
        res.json({
          success: true,
          report: stdout,
          parsed,
          config: {
            apiType: resolvedApiType,
            apiUrl: finalUrl,
            model,
            rate: sanitizedRate,
            duration: sanitizedDuration,
          },
        });
      },
    );
  } catch (e) {
    console.error("❌ Server error:", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
