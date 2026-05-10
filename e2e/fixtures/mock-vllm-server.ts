import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Minimal HTTP server that mimics a vLLM-style endpoint for e2e testing
 * connection-discovery (#151). Exposes:
 *   - GET /v1/models  → OpenAI shape with 1 model
 *   - GET /metrics    → Prometheus body containing `vllm:` prefix
 *   - GET /health     → 200 ok
 *   - GET /           → empty body, Server header
 *
 * Bind on port 0; the actual port is exposed via `.url` after `.start()`.
 */
export class MockVllmServer {
  private server: Server | null = null;
  url = "";

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      switch (req.url) {
        case "/v1/models": {
          const body = JSON.stringify({ data: [{ id: "llama-3-8b-instruct" }] });
          res.writeHead(200, {
            "content-type": "application/json",
            "content-length": String(Buffer.byteLength(body)),
          });
          res.end(body);
          return;
        }
        case "/metrics": {
          const body =
            "# HELP vllm:request_success_total Successful requests\n" +
            "# TYPE vllm:request_success_total counter\n" +
            "vllm:request_success_total 42\n" +
            "# HELP vllm:gpu_cache_usage_perc GPU KV-cache utilisation\n" +
            "# TYPE vllm:gpu_cache_usage_perc gauge\n" +
            "vllm:gpu_cache_usage_perc 0.5\n";
          res.writeHead(200, {
            "content-type": "text/plain; version=0.0.4",
            "content-length": String(Buffer.byteLength(body)),
          });
          res.end(body);
          return;
        }
        case "/health":
          res.writeHead(200, { "content-type": "text/plain", "content-length": "2" });
          res.end("ok");
          return;
        case "/":
          res.writeHead(200, { Server: "vLLM/0.6.4", "content-length": "0" });
          res.end();
          return;
        default:
          res.writeHead(404, { "content-length": "9" });
          res.end("not found");
      }
    });
    await new Promise<void>((resolve) => {
      this.server?.listen(0, "127.0.0.1", () => {
        const port = (this.server?.address() as AddressInfo).port;
        this.url = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) => {
      this.server?.close((err) => (err ? reject(err) : resolve()));
    });
    this.server = null;
  }
}
