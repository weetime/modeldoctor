// Phase 2 (#53): canonical implementation lives in src/common/hmac/.
// This shim keeps the benchmark module's existing imports compiling;
// Phase 3 (#53 PR 3/4) deletes the benchmark/callbacks directory along
// with this shim.
export * from "../../../common/hmac/hmac-token.js";
