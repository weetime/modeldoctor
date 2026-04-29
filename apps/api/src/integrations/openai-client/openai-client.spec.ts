import { describe, expect, it } from "vitest";
import { buildHeaders, buildUrl, parseHeaderLines, parseQueryLines } from "./url.js";

describe("parseHeaderLines", () => {
  it("returns empty record for undefined / blank", () => {
    expect(parseHeaderLines(undefined)).toEqual({});
    expect(parseHeaderLines("")).toEqual({});
    expect(parseHeaderLines("   \n  ")).toEqual({});
  });

  it("parses 'K: v' lines, trims, ignores malformed", () => {
    expect(parseHeaderLines("X-Foo: bar\n  X-Baz : qux \nignored\nX-Empty:")).toEqual({
      "X-Foo": "bar",
      "X-Baz": "qux",
      "X-Empty": "",
    });
  });
});

describe("parseQueryLines", () => {
  it("parses 'k=v' lines", () => {
    expect(parseQueryLines("api-version=2024-02-01\nfoo=bar\n=skipme")).toEqual({
      "api-version": "2024-02-01",
      foo: "bar",
    });
  });
});

describe("buildHeaders", () => {
  it("merges Authorization + Content-Type with custom headers", () => {
    const h = buildHeaders("sk-1", "X-Foo: bar");
    expect(h.Authorization).toBe("Bearer sk-1");
    expect(h["Content-Type"]).toBe("application/json");
    expect(h["X-Foo"]).toBe("bar");
  });

  it("lets caller override Content-Type via customHeaders", () => {
    const h = buildHeaders("k", "Content-Type: multipart/form-data");
    expect(h["Content-Type"]).toBe("multipart/form-data");
  });
});

describe("buildUrl", () => {
  it("joins base + default path, collapses trailing slash", () => {
    expect(buildUrl({ apiBaseUrl: "http://x.test/", defaultPath: "/v1/chat/completions" })).toBe(
      "http://x.test/v1/chat/completions",
    );
  });

  it("uses pathOverride when given", () => {
    expect(
      buildUrl({
        apiBaseUrl: "http://x",
        defaultPath: "/v1/chat/completions",
        pathOverride: "/custom",
      }),
    ).toBe("http://x/custom");
  });

  it("normalises pathOverride lacking a leading slash", () => {
    expect(buildUrl({ apiBaseUrl: "http://x", defaultPath: "/d", pathOverride: "custom" })).toBe(
      "http://x/custom",
    );
  });

  it("appends queryParams as URLSearchParams", () => {
    const url = buildUrl({
      apiBaseUrl: "http://x",
      defaultPath: "/v1/embeddings",
      queryParams: "api-version=2024-02-01\nfoo=bar",
    });
    expect(url).toMatch(/^http:\/\/x\/v1\/embeddings\?/);
    expect(url).toContain("api-version=2024-02-01");
    expect(url).toContain("foo=bar");
  });

  it("uses & if pathOverride already contains ?", () => {
    const url = buildUrl({
      apiBaseUrl: "http://x",
      defaultPath: "/d",
      pathOverride: "/p?a=1",
      queryParams: "b=2",
    });
    expect(url).toBe("http://x/p?a=1&b=2");
  });
});
