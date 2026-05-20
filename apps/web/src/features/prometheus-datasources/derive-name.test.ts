import { describe, expect, it } from "vitest";
import { deriveDatasourceNameFromUrl } from "./derive-name";

describe("deriveDatasourceNameFromUrl", () => {
  it("returns host:port for a typical Prometheus URL", () => {
    expect(deriveDatasourceNameFromUrl("http://prom.lab:9090/")).toBe("prom.lab:9090");
  });

  it("returns just the host when the default port is used", () => {
    expect(deriveDatasourceNameFromUrl("http://prom.example.com/")).toBe("prom.example.com");
  });

  it("returns empty string for an unparseable URL", () => {
    expect(deriveDatasourceNameFromUrl("not a url")).toBe("");
  });

  it("returns empty string for null", () => {
    expect(deriveDatasourceNameFromUrl(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(deriveDatasourceNameFromUrl(undefined)).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(deriveDatasourceNameFromUrl("")).toBe("");
  });
});
