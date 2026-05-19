import { ApiError } from "@/lib/api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { toastError, toastSuccess } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: toastError, success: toastSuccess },
}));

import { toastDatasourceError } from "./errors";

// Stand-in for the i18next `t` bound to the prometheus-datasources namespace.
// Returns the key so we can assert which key was looked up without pulling in
// the real translation runtime — schema-level coverage, not i18n coverage.
const t = (key: string, opts?: Record<string, unknown>) =>
  opts && "message" in opts ? `${key}|${opts.message}` : key;

describe("toastDatasourceError", () => {
  beforeEach(() => {
    toastError.mockClear();
    toastSuccess.mockClear();
  });

  it("maps PROMETHEUS_DATASOURCE_NAME_TAKEN to toast.errors.nameTaken", () => {
    toastDatasourceError(t, new ApiError(409, "name taken", "PROMETHEUS_DATASOURCE_NAME_TAKEN"));
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith("toast.errors.nameTaken");
  });

  it("maps PROMETHEUS_DATASOURCE_BASEURL_TAKEN to toast.errors.baseUrlTaken", () => {
    toastDatasourceError(
      t,
      new ApiError(409, "baseurl taken", "PROMETHEUS_DATASOURCE_BASEURL_TAKEN"),
    );
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith("toast.errors.baseUrlTaken");
  });

  it("falls back to toast.errors.generic with the error message when code is unknown", () => {
    toastDatasourceError(t, new Error("boom"));
    expect(toastError).toHaveBeenCalledTimes(1);
    // Our stand-in `t` echoes opts.message after a `|` so we can lock both.
    expect(toastError).toHaveBeenCalledWith("toast.errors.generic|boom");
  });

  it("falls back to generic with empty message when error is not an Error", () => {
    toastDatasourceError(t, "string thrown by something else");
    expect(toastError).toHaveBeenCalledWith("toast.errors.generic|");
  });

  it("falls back to generic when ApiError carries an unrelated code", () => {
    // Defends against a future ConflictException codepath that happens to
    // raise via ApiError but with a code outside the known two — should NOT
    // accidentally surface as a localized takeover.
    toastDatasourceError(t, new ApiError(409, "something else", "SOMETHING_UNRELATED_TAKEN"));
    expect(toastError).toHaveBeenCalledWith("toast.errors.generic|something else");
  });
});
