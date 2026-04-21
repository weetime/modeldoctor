// Shared API configuration: type switcher, cURL import, vegeta status badge.
// These concerns are reused by both load test and E2E test modes.

const apiTypePaths = {
  chat: "/v1/chat/completions",
  embeddings: "/v1/embeddings",
  rerank: "/rerank",
  images: "/v1/images/generations",
  "chat-vision": "/v1/chat/completions",
  "chat-audio": "/v1/chat/completions",
};

const paramSectionIds = {
  chat: "chatParams",
  embeddings: "embeddingsParams",
  rerank: "rerankParams",
  images: "imagesParams",
  "chat-vision": "chatVisionParams",
  "chat-audio": "chatAudioParams",
};

function getParamSections() {
  const map = {};
  for (const [t, id] of Object.entries(paramSectionIds)) {
    const el = document.getElementById(id);
    if (el) map[t] = el;
  }
  return map;
}

function initApiTypeSwitcher() {
  const apiTypeSelect = document.getElementById("apiType");
  if (!apiTypeSelect) return;
  const sections = getParamSections();

  apiTypeSelect.addEventListener("change", () => {
    const selected = apiTypeSelect.value;
    for (const [type, section] of Object.entries(sections)) {
      section.style.display = type === selected ? "" : "none";
    }

    const apiUrlInput = document.getElementById("apiUrl");
    if (!apiUrlInput) return;
    try {
      const url = new URL(apiUrlInput.value);
      let pathname = url.pathname;
      for (const suffix of Object.values(apiTypePaths)) {
        if (pathname.endsWith(suffix)) {
          pathname = pathname.slice(0, -suffix.length);
          break;
        }
      }
      url.pathname = pathname + (apiTypePaths[selected] || "");
      apiUrlInput.value = url.toString();
    } catch {
      // invalid URL — leave as-is
    }
  });
}

function parseCurlCommand(curlStr) {
  const result = { url: "", headers: {}, body: null, queryParams: "" };
  let cmd = curlStr.replace(/\\\s*\n/g, " ").trim();
  cmd = cmd.replace(/^curl\s+/, "");

  const urlPatterns = [/(?:^|\s)['"]?(https?:\/\/[^\s'"]+)['"]?/, /(?:^|\s)([^\s-][^\s]*)/];
  for (const pattern of urlPatterns) {
    const match = cmd.match(pattern);
    if (match && match[1] && (match[1].startsWith("http://") || match[1].startsWith("https://"))) {
      result.url = match[1].replace(/['"]$/, "");
      break;
    }
  }

  if (result.url) {
    try {
      const url = new URL(result.url);
      if (url.search) {
        const params = [];
        url.searchParams.forEach((v, k) => params.push(`${k}=${v}`));
        result.queryParams = params.join("\n");
        url.search = "";
        result.url = url.toString();
      }
    } catch {}
  }

  const headerRegex = /(?:-H|--header)\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = headerRegex.exec(cmd)) !== null) {
    const colon = m[1].indexOf(":");
    if (colon > 0) {
      const key = m[1].substring(0, colon).trim();
      const value = m[1].substring(colon + 1).trim();
      result.headers[key.toLowerCase()] = { originalKey: key, value };
    }
  }

  const bodyRegex = /(?:-d|--data-raw|--data)\s+'([\s\S]*?)(?:(?<!\\)')/;
  const bodyMatch = cmd.match(bodyRegex);
  if (bodyMatch) {
    try {
      result.body = JSON.parse(bodyMatch[1]);
    } catch {
      try {
        result.body = JSON.parse(bodyMatch[1].replace(/\\'/g, "'"));
      } catch {}
    }
  }
  if (!result.body) {
    const bodyRegex2 = /(?:-d|--data-raw|--data)\s+"([\s\S]*?)(?:(?<!\\)")/;
    const bodyMatch2 = cmd.match(bodyRegex2);
    if (bodyMatch2) {
      try {
        result.body = JSON.parse(bodyMatch2[1].replace(/\\"/g, '"'));
      } catch {}
    }
  }

  return result;
}

function detectApiType(url, body) {
  if (url.includes("/v1/images/generations") || url.includes("/images/generations")) return "images";
  if (url.includes("/v1/embeddings") || url.includes("/embeddings")) return "embeddings";
  if (url.includes("/rerank")) return "rerank";
  if (body) {
    if (body.prompt && !body.messages) return "images";
    if (body.input && !body.messages) return "embeddings";
    if (body.query && body.texts) return "rerank";
  }
  return "chat";
}

function initCurlImport() {
  const btn = document.getElementById("parseCurlBtn");
  const input = document.getElementById("curlInput");
  const feedback = document.getElementById("curlFeedback");
  const apiTypeSelect = document.getElementById("apiType");
  if (!btn || !input || !feedback || !apiTypeSelect) return;

  btn.addEventListener("click", () => {
    const curlStr = input.value.trim();
    if (!curlStr) {
      feedback.textContent = "Please paste a curl command first";
      feedback.className = "curl-feedback error";
      return;
    }

    const parsed = parseCurlCommand(curlStr);
    const filled = [];

    if (parsed.url || parsed.body) {
      const detected = detectApiType(parsed.url || "", parsed.body);
      apiTypeSelect.value = detected;
      apiTypeSelect.dispatchEvent(new Event("change"));
      filled.push(`Type (${detected})`);
    }

    if (parsed.url) {
      document.getElementById("apiUrl").value = parsed.url;
      filled.push("URL");
    }

    const authEntry = parsed.headers["authorization"];
    if (authEntry) {
      document.getElementById("apiKey").value = authEntry.value.replace(/^Bearer\s+/i, "");
      filled.push("API Key");
    }

    if (parsed.queryParams) {
      document.getElementById("queryParams").value = parsed.queryParams;
      filled.push("Query Params");
    }

    const skipHeaders = ["content-type", "authorization"];
    const customLines = [];
    for (const [lowerKey, entry] of Object.entries(parsed.headers)) {
      if (!skipHeaders.includes(lowerKey)) customLines.push(`${entry.originalKey}: ${entry.value}`);
    }
    if (customLines.length > 0) {
      document.getElementById("customHeaders").value = customLines.join("\n");
      filled.push("Custom Headers");
    }

    if (parsed.body) {
      if (parsed.body.model) {
        document.getElementById("model").value = parsed.body.model;
        filled.push("Model");
      }
      const apiType = apiTypeSelect.value;
      if (apiType === "chat") {
        if (parsed.body.messages && parsed.body.messages.length > 0) {
          const userMsg = [...parsed.body.messages].reverse().find((m) => m.role === "user");
          if (userMsg && userMsg.content) {
            document.getElementById("prompt").value = userMsg.content;
            filled.push("Prompt");
          }
        }
        if (parsed.body.max_tokens !== undefined) {
          document.getElementById("maxTokens").value = parsed.body.max_tokens;
          filled.push("Max Tokens");
        }
        if (parsed.body.temperature !== undefined) {
          document.getElementById("temperature").value = parsed.body.temperature;
          filled.push("Temperature");
        }
        if (parsed.body.stream !== undefined) {
          document.getElementById("stream").checked = !!parsed.body.stream;
          filled.push("Stream");
        }
      } else if (apiType === "embeddings") {
        if (parsed.body.input) {
          const text = Array.isArray(parsed.body.input) ? parsed.body.input.join("\n") : parsed.body.input;
          document.getElementById("embeddingInput").value = text;
          filled.push("Input");
        }
      } else if (apiType === "rerank") {
        if (parsed.body.query) {
          document.getElementById("rerankQuery").value = parsed.body.query;
          filled.push("Query");
        }
        if (parsed.body.texts) {
          document.getElementById("rerankTexts").value = parsed.body.texts.join("\n");
          filled.push("Texts");
        }
      } else if (apiType === "images") {
        if (parsed.body.prompt) {
          document.getElementById("imagePrompt").value = parsed.body.prompt;
          filled.push("Prompt");
        }
        if (parsed.body.size) {
          document.getElementById("imageSize").value = parsed.body.size;
          filled.push("Size");
        }
        if (parsed.body.n) {
          document.getElementById("imageN").value = parsed.body.n;
          filled.push("N");
        }
      }
    }

    if (filled.length > 0) {
      feedback.textContent = `Filled: ${filled.join(", ")}`;
      feedback.className = "curl-feedback success";
    } else {
      feedback.textContent = "Could not extract parameters from curl command";
      feedback.className = "curl-feedback error";
    }
  });
}

async function initVegetaStatus() {
  const badge = document.getElementById("vegetaStatus");
  if (!badge) return;
  try {
    const r = await fetch("/api/check-vegeta");
    const data = await r.json();
    if (data.installed) {
      badge.textContent = `✅ Vegeta installed at ${data.path}`;
      badge.className = "status-badge installed";
    } else {
      badge.textContent = "❌ Vegeta not installed";
      badge.className = "status-badge not-installed";
    }
  } catch {
    badge.textContent = "⚠️ Unable to check Vegeta status";
    badge.className = "status-badge not-installed";
  }
}

export function initSharedConfig() {
  initApiTypeSwitcher();
  initCurlImport();
  initVegetaStatus();
}

// Expose helpers that other page modules may need.
export function readApiConfig() {
  const form = document.getElementById("loadTestForm");
  const formData = new FormData(form);
  return {
    apiType: document.getElementById("apiType").value,
    apiUrl: formData.get("apiUrl"),
    apiKey: formData.get("apiKey"),
    model: formData.get("model"),
    customHeaders: formData.get("customHeaders") || "",
    queryParams: formData.get("queryParams") || "",
  };
}

export function readTypeParams(apiType) {
  const form = document.getElementById("loadTestForm");
  const formData = new FormData(form);
  if (apiType === "chat") {
    return {
      prompt: formData.get("prompt"),
      maxTokens: parseInt(formData.get("maxTokens")),
      temperature: parseFloat(formData.get("temperature")),
      stream: document.getElementById("stream").checked,
    };
  }
  if (apiType === "embeddings") return { embeddingInput: formData.get("embeddingInput") };
  if (apiType === "rerank") {
    return {
      rerankQuery: formData.get("rerankQuery"),
      rerankTexts: formData.get("rerankTexts"),
    };
  }
  if (apiType === "images") {
    return {
      imagePrompt: formData.get("imagePrompt"),
      imageSize: formData.get("imageSize"),
      imageN: parseInt(formData.get("imageN")) || 1,
    };
  }
  if (apiType === "chat-vision") {
    return {
      imageUrl: formData.get("visionImageUrl"),
      prompt: formData.get("visionPrompt"),
      systemPrompt: formData.get("visionSystemPrompt") || "",
      maxTokens: parseInt(formData.get("visionMaxTokens")) || 256,
      temperature: parseFloat(formData.get("visionTemperature")) || 0,
    };
  }
  if (apiType === "chat-audio") {
    return {
      prompt: formData.get("audioPrompt"),
      systemPrompt: formData.get("audioSystemPrompt") || "",
    };
  }
  return {};
}
