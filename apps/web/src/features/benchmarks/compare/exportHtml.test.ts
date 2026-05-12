import { describe, expect, it } from "vitest";
import { buildExportHtml } from "./exportHtml";

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
});
