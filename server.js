const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3001;

// Disable X-Powered-By header for security.
app.disable("x-powered-by");

// Middleware configuration.
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

/**
 * Health check endpoint.
 */
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

/**
 * Main load testing endpoint.
 * Receives configuration and executes Vegeta load test.
 */
app.post("/api/load-test", async (req, res) => {
  const {
    apiUrl,
    apiKey,
    model,
    prompt,
    maxTokens,
    temperature,
    stream,
    rate,
    duration,
  } = req.body;

  // Validate required parameters.
  if (!apiUrl || !apiKey || !model || !prompt) {
    return res.status(400).json({
      success: false,
      error: "Missing required parameters",
    });
  }

  // Validate and sanitize rate and duration to prevent command injection.
  const sanitizedRate = parseInt(rate, 10);
  const sanitizedDuration = parseInt(duration, 10);

  if (
    !Number.isInteger(sanitizedRate) ||
    sanitizedRate < 1 ||
    sanitizedRate > 10000
  ) {
    return res.status(400).json({
      success: false,
      error: "Invalid rate parameter. Must be an integer between 1 and 10000.",
    });
  }

  if (
    !Number.isInteger(sanitizedDuration) ||
    sanitizedDuration < 1 ||
    sanitizedDuration > 3600
  ) {
    return res.status(400).json({
      success: false,
      error:
        "Invalid duration parameter. Must be an integer between 1 and 3600.",
    });
  }

  try {
    console.log("🚀 Starting load test with configuration:", {
      apiUrl,
      model,
      rate,
      duration: `${duration}s`,
    });

    // Create request body JSON file.
    const requestBody = {
      model,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: parseInt(maxTokens) || 1000,
      temperature: parseFloat(temperature) || 0.7,
      stream: !!stream,
    };

    const requestJsonPath = path.join(__dirname, "request.json");
    fs.writeFileSync(requestJsonPath, JSON.stringify(requestBody, null, 2));
    console.log("✅ Created request.json");

    // Create Vegeta request format file.
    const requestTxt = `POST ${apiUrl}
Content-Type: application/json
Authorization: Bearer ${apiKey}
@request.json`;

    const requestTxtPath = path.join(__dirname, "request.txt");
    fs.writeFileSync(requestTxtPath, requestTxt);
    console.log("✅ Created request.txt");

    // Execute Vegeta command with sanitized parameters.
    const vegetaCmd = `cat request.txt | vegeta attack -rate=${sanitizedRate} -duration=${sanitizedDuration}s | vegeta report`;
    console.log("🔨 Executing Vegeta command:", vegetaCmd);

    // Set execution timeout to prevent resource exhaustion (max duration + 60s buffer).
    const timeoutMs = (sanitizedDuration + 60) * 1000;

    exec(
      vegetaCmd,
      {
        cwd: __dirname,
        maxBuffer: 10 * 1024 * 1024,
        timeout: timeoutMs,
      },
      (error, stdout, stderr) => {
        if (error) {
          console.error("❌ Vegeta execution error:", error);
          return res.status(500).json({
            success: false,
            error: error.message,
            stderr: stderr,
          });
        }

        if (stderr) {
          console.warn("⚠️  Vegeta stderr:", stderr);
        }

        console.log("✅ Load test completed successfully");
        console.log("📊 Results:\n", stdout);

        // Parse Vegeta report.
        const report = parseVegetaReport(stdout);

        res.json({
          success: true,
          report: stdout,
          parsed: report,
          config: {
            apiUrl,
            model,
            rate: sanitizedRate,
            duration: sanitizedDuration,
            prompt: prompt.substring(0, 50) + (prompt.length > 50 ? "..." : ""),
          },
        });
      },
    );
  } catch (error) {
    console.error("❌ Server error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Parses Vegeta report output into structured data.
 * @param {string} report - Raw Vegeta report text.
 * @returns {object} Parsed report data.
 */
function parseVegetaReport(report) {
  const parsed = {
    requests: null,
    rate: null,
    throughput: null,
    duration: null,
    latencies: {},
    bytesIn: null,
    bytesOut: null,
    success: null,
    statusCodes: {},
  };

  const lines = report.split("\n");

  lines.forEach((line) => {
    // Extract requests - format: "Requests      [total, rate, throughput]         240, 2.01, 0.01"
    if (line.includes("Requests") && line.includes("[total")) {
      const match = line.match(/Requests\s+\[.*?\]\s+([\d.]+)/);
      if (match) parsed.requests = parseInt(match[1]);

      // Also extract rate and throughput from the same line.
      const valuesMatch = line.match(/\]\s+([\d.]+),\s+([\d.]+),\s+([\d.]+)/);
      if (valuesMatch) {
        parsed.requests = parseInt(valuesMatch[1]);
        parsed.rate = parseFloat(valuesMatch[2]);
        parsed.throughput = parseFloat(valuesMatch[3]);
      }
    }

    // Extract duration - format: "Duration      [total, attack, wait]             2m30s, 2m0s, 30.002s"
    if (line.includes("Duration") && line.includes("[total")) {
      const match = line.match(/\]\s+([\d.]+[a-z]+)/);
      if (match) parsed.duration = match[1];
    }

    // Extract latencies - format: "Latencies     [min, mean, 50, 90, 95, 99, max]  17.529s, 29.939s, 30.001s, 30.003s, 30.004s, 30.006s, 30.01s"
    if (line.includes("Latencies") && line.includes("[min")) {
      const valuesMatch = line.match(
        /\]\s+([\d.]+[a-z]+),\s+([\d.]+[a-z]+),\s+([\d.]+[a-z]+),\s+([\d.]+[a-z]+),\s+([\d.]+[a-z]+),\s+([\d.]+[a-z]+),\s+([\d.]+[a-z]+)/,
      );
      if (valuesMatch) {
        parsed.latencies.min = valuesMatch[1];
        parsed.latencies.mean = valuesMatch[2];
        parsed.latencies.p50 = valuesMatch[3];
        parsed.latencies.p90 = valuesMatch[4];
        parsed.latencies.p95 = valuesMatch[5];
        parsed.latencies.p99 = valuesMatch[6];
        parsed.latencies.max = valuesMatch[7];
      }
    }

    // Extract bytes - format: "Bytes In      [total, mean]                     4584, 19.10"
    if (line.includes("Bytes In") && line.includes("[total")) {
      const match = line.match(/\]\s+([\d.]+)/);
      if (match) parsed.bytesIn = parseInt(match[1]);
    }

    if (line.includes("Bytes Out") && line.includes("[total")) {
      const match = line.match(/\]\s+([\d.]+)/);
      if (match) parsed.bytesOut = parseInt(match[1]);
    }

    // Extract success rate - format: "Success       [ratio]                           0.83%"
    if (line.includes("Success") && line.includes("[ratio]")) {
      const match = line.match(/\]\s+([\d.]+)%/);
      if (match) parsed.success = parseFloat(match[1]);
    }

    // Extract status codes - format: "Status Codes  [code:count]                      0:238  200:2"
    if (line.includes("Status Codes") && line.includes("[code:count]")) {
      const match = line.match(/\[code:count\]\s+(.*)/);
      if (match) {
        const codes = match[1].trim().split(/\s+/);
        codes.forEach((code) => {
          const [status, count] = code.split(":");
          if (status && count) {
            parsed.statusCodes[status] = parseInt(count);
          }
        });
      }
    }
  });

  return parsed;
}

/**
 * Check if Vegeta is installed.
 */
app.get("/api/check-vegeta", (req, res) => {
  exec("which vegeta", (error, stdout, stderr) => {
    if (error) {
      return res.json({
        installed: false,
        message: "Vegeta is not installed. Please install it first.",
        path: null,
      });
    }

    res.json({
      installed: true,
      message: "Vegeta is installed",
      path: stdout.trim(),
    });
  });
});

// Start server.
app.listen(PORT, () => {
  console.log("🚀 Vegeta Load Test Control Server");
  console.log(`📡 Server running at http://localhost:${PORT}`);
  console.log("📝 Ready to accept load test requests");
  console.log("");
  console.log("💡 Tip: Make sure Vegeta is installed on your system");
  console.log("   macOS: brew install vegeta");
  console.log(
    "   Linux: Download from https://github.com/tsenart/vegeta/releases",
  );
  console.log("");
});
