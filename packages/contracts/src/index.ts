/**
 * @modeldoctor/contracts
 *
 * Shared Zod schemas that define the HTTP wire format between the web UI and
 * the API. Consumers import schemas from here and derive types via z.infer.
 */

export * from "./errors.js";
export * from "./common.js";
export * from "./health.js";
export * from "./debug-proxy.js";
export * from "./modality.js";
export * from "./auth.js";
export * from "./connection.js";
export * from "./playground.js";
export * from "./benchmark.js";
export * from "./benchmark-template.js";
export * from "./diagnostics.js";
export * from "./baseline.js";
export * from "./engine.js";
export * from "./insights/index.js";
export * from "./engine-metrics.js";
export * from "./engine-metrics/manifests/index.js";
export * from "./notifications.js";
