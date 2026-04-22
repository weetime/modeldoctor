/**
 * @modeldoctor/contracts
 *
 * Shared Zod schemas that define the HTTP wire format between the web UI and
 * the API. Consumers import schemas from here and derive types via z.infer.
 *
 * Phase 0 scaffold: no schemas yet. Phase 1 populates health, e2e-test,
 * load-test, and debug-proxy schemas.
 */

export * from "./errors.js";
export * from "./common.js";
export * from "./health.js";
