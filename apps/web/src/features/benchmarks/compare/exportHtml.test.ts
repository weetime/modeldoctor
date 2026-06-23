import { afterEach, describe, expect, it, vi } from "vitest";
import { buildExportHtml } from "./exportHtml";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildExportHtml", () => {
  it("wraps cloned node in a full HTML document with inline styles", () => {
    const root = document.createElement("div");
    root.innerHTML = "<h1>Report</h1><p>Body</p>";
    const html = buildExportHtml(root, "my-report", "body { font-family: sans-serif; }");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>my-report</title>");
    expect(html).toContain("<h1>Report</h1>");
    expect(html).toContain("font-family: sans-serif");
  });

  it("escapes the title", () => {
    const root = document.createElement("div");
    const html = buildExportHtml(root, "evil <script>", "");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("replaces each chart canvas with an inline <img> PNG snapshot", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,SNAPSHOT",
    );
    const root = document.createElement("div");
    root.innerHTML =
      '<div class="pr-figure"><canvas class="chart" width="600" height="300"></canvas></div>';
    const html = buildExportHtml(root, "r", "");
    expect(html).toContain("<img");
    expect(html).toContain("data:image/png;base64,SNAPSHOT");
    expect(html).not.toContain("<canvas");
  });

  it("leaves the canvas in place when snapshotting fails (does not throw)", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(() => {
      throw new Error("tainted canvas");
    });
    const root = document.createElement("div");
    root.innerHTML = "<canvas></canvas>";
    let html = "";
    expect(() => {
      html = buildExportHtml(root, "r", "");
    }).not.toThrow();
    expect(html).toContain("<canvas");
  });
});
