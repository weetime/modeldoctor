const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");

const healthRouter = require("./src/routes/health");
const loadTestRouter = require("./src/routes/load-test");
const e2eRouter = require("./src/routes/e2e-test");

const PORT = process.env.PORT || 3001;

const app = express();
app.disable("x-powered-by");
app.use(cors());
app.use(bodyParser.json({ limit: "10mb" }));
app.use(express.static("public"));

app.use("/api", healthRouter);
app.use("/api", loadTestRouter);
app.use("/api", e2eRouter);

app.listen(PORT, () => {
  console.log("🚀 InferBench");
  console.log(`📡 Server running at http://localhost:${PORT}`);
  console.log("💡 Tip: Make sure Vegeta is installed (brew install vegeta)");
});
