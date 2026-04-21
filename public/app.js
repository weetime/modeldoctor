// Entry point: loads shared config and each page module.
import { initSharedConfig } from "./pages/shared-config.js";
import { initLoadTest } from "./pages/load-test.js";
import { initE2ETest } from "./pages/e2e-test.js";

initSharedConfig();
initLoadTest();
initE2ETest();

console.log("🚀 InferBench initialized");
