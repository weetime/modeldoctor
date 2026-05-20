import { describe, expect, it } from "vitest";
import { normalizeBaseUrl } from "./normalize-base-url";

describe("normalizeBaseUrl", () => {
  it("strips a single trailing slash", () => {
    expect(normalizeBaseUrl("http://prom:9090/")).toBe("http://prom:9090");
  });

  it("strips multiple trailing slashes", () => {
    expect(normalizeBaseUrl("http://prom:9090///")).toBe("http://prom:9090");
  });

  it("leaves a URL without a trailing slash unchanged", () => {
    expect(normalizeBaseUrl("http://prom:9090")).toBe("http://prom:9090");
  });

  it("lowercases protocol and host but preserves path case", () => {
    expect(normalizeBaseUrl("HTTP://Prom.Lab:9090/Path/Sub/")).toBe(
      "http://prom.lab:9090/Path/Sub",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeBaseUrl("  http://prom:9090/  ")).toBe("http://prom:9090");
  });

  it("preserves query string and hash", () => {
    expect(normalizeBaseUrl("http://prom:9090/api/?foo=bar#frag")).toBe(
      "http://prom:9090/api?foo=bar#frag",
    );
  });

  it("returns empty string for null", () => {
    expect(normalizeBaseUrl(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(normalizeBaseUrl(undefined)).toBe("");
  });

  it("returns empty string for empty / whitespace-only input", () => {
    expect(normalizeBaseUrl("")).toBe("");
    expect(normalizeBaseUrl("   ")).toBe("");
  });

  it("falls back to trimmed + trailing-slash-stripped on unparseable input", () => {
    expect(normalizeBaseUrl("not a url/")).toBe("not a url");
  });
});
