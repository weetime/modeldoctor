const express = require("express");

const router = express.Router();

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_BODY_BYTES = 20 * 1024 * 1024; // 20 MB

function looksBinary(contentType) {
  if (!contentType) return false;
  if (contentType.startsWith("image/")) return true;
  if (contentType.startsWith("audio/")) return true;
  if (contentType.startsWith("video/")) return true;
  if (contentType === "application/octet-stream") return true;
  return false;
}

router.post("/debug/proxy", async (req, res) => {
  const {
    method = "GET",
    url,
    headers = {},
    body = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = req.body || {};

  if (!url || typeof url !== "string") {
    return res.status(400).json({ success: false, error: "url is required" });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const startedAt = Date.now();
  let ttfbAt = null;

  try {
    const init = {
      method: method.toUpperCase(),
      headers,
      signal: controller.signal,
    };
    if (body !== null && body !== undefined && init.method !== "GET" && init.method !== "HEAD") {
      init.body = body;
    }
    const response = await fetch(url, init);
    ttfbAt = Date.now();

    const contentType = response.headers.get("content-type") || "";
    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.byteLength > MAX_BODY_BYTES) {
      return res.json({
        success: false,
        error: `Response body exceeds ${MAX_BODY_BYTES} bytes`,
      });
    }

    const binary = looksBinary(contentType);
    const responseBody = binary
      ? buffer.toString("base64")
      : buffer.toString("utf-8");

    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    res.json({
      success: true,
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: responseBody,
      bodyEncoding: binary ? "base64" : "text",
      timingMs: {
        ttfbMs: ttfbAt - startedAt,
        totalMs: Date.now() - startedAt,
      },
      sizeBytes: buffer.byteLength,
    });
  } catch (err) {
    res.json({
      success: false,
      error: err.name === "AbortError" ? "Request timeout / aborted" : String(err.message || err),
    });
  } finally {
    clearTimeout(timer);
  }
});

module.exports = router;
