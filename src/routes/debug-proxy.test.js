const express = require("express");
const bodyParser = require("body-parser");
const request = require("supertest");

const debugProxyRouter = require("./debug-proxy");

let server;
let baseUrl;

beforeAll(async () => {
  // Local fake target
  const target = express();
  target.use(bodyParser.json());
  target.post("/echo", (req, res) => {
    res.status(200).json({ youSent: req.body, header: req.headers["x-foo"] });
  });
  target.get("/timeout", () => {
    // Never respond — exercises proxy timeout
  });
  await new Promise((resolve) => {
    server = target.listen(0, () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server.close();
});

function makeApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use("/api", debugProxyRouter);
  return app;
}

describe("POST /api/debug/proxy", () => {
  it("forwards body and returns parsed response", async () => {
    const app = makeApp();
    const res = await request(app).post("/api/debug/proxy").send({
      method: "POST",
      url: `${baseUrl}/echo`,
      headers: { "X-Foo": "bar", "Content-Type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe(200);
    expect(res.body.bodyEncoding).toBe("text");
    const echoed = JSON.parse(res.body.body);
    expect(echoed.youSent).toEqual({ a: 1 });
    expect(echoed.header).toBe("bar");
    expect(typeof res.body.timingMs.totalMs).toBe("number");
  });

  it("returns success:false on timeout", async () => {
    const app = makeApp();
    const res = await request(app).post("/api/debug/proxy").send({
      method: "GET",
      url: `${baseUrl}/timeout`,
      headers: {},
      body: null,
      timeoutMs: 200,
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/timeout|aborted/i);
  });

  it("rejects missing url", async () => {
    const app = makeApp();
    const res = await request(app).post("/api/debug/proxy").send({});
    expect(res.status).toBe(400);
  });
});
