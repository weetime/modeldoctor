const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const path = require("node:path");

const healthRouter = require("./src/routes/health");
const loadTestRouter = require("./src/routes/load-test");
const e2eRouter = require("./src/routes/e2e-test");
// debug-proxy router is added in Phase 4 Task 27.

const PORT = process.env.PORT || 3001;
const DIST_DIR = path.join(__dirname, "dist");

const app = express();
app.disable("x-powered-by");
app.use(cors());
app.use(bodyParser.json({ limit: "10mb" }));

app.use("/api", healthRouter);
app.use("/api", loadTestRouter);
app.use("/api", e2eRouter);

app.use(express.static(DIST_DIR));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(DIST_DIR, "index.html"));
});

app.listen(PORT, () => {
  console.log("ModelDoctor server");
  console.log(`Listening on http://localhost:${PORT}`);
});
