import { describe, expect, it } from "vitest";
import { ErrorCodes } from "./errors.js";

describe("ErrorCodes", () => {
  it("includes the 8 Phase-1/2 baseline codes", () => {
    expect(ErrorCodes.VALIDATION_FAILED).toBe("VALIDATION_FAILED");
    expect(ErrorCodes.BAD_REQUEST).toBe("BAD_REQUEST");
    expect(ErrorCodes.UNAUTHORIZED).toBe("UNAUTHORIZED");
    expect(ErrorCodes.FORBIDDEN).toBe("FORBIDDEN");
    expect(ErrorCodes.NOT_FOUND).toBe("NOT_FOUND");
    expect(ErrorCodes.CONFLICT).toBe("CONFLICT");
    expect(ErrorCodes.TOO_MANY_REQUESTS).toBe("TOO_MANY_REQUESTS");
    expect(ErrorCodes.INTERNAL_SERVER_ERROR).toBe("INTERNAL_SERVER_ERROR");
  });

  it("includes the Phase 3 benchmark codes", () => {
    expect(ErrorCodes.BENCHMARK_DATASET_UNSUPPORTED).toBe("BENCHMARK_DATASET_UNSUPPORTED");
    expect(ErrorCodes.BENCHMARK_NAME_IN_USE).toBe("BENCHMARK_NAME_IN_USE");
    expect(ErrorCodes.BENCHMARK_ALREADY_TERMINAL).toBe("BENCHMARK_ALREADY_TERMINAL");
    expect(ErrorCodes.BENCHMARK_NOT_TERMINAL).toBe("BENCHMARK_NOT_TERMINAL");
  });
});
