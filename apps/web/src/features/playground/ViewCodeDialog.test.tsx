import "@/lib/i18n";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ViewCodeDialog } from "./ViewCodeDialog";

/** Snippets with no base64: readable === full */
const plainSnips = {
  curlReadable: "curl -X POST http://x",
  curlFull: "curl -X POST http://x",
  pythonReadable: "from openai import OpenAI",
  pythonFull: "from openai import OpenAI",
  nodeReadable: "import OpenAI from 'openai';",
  nodeFull: "import OpenAI from 'openai';",
};

/** Snippets with base64: readable !== full */
const base64Snips = {
  curlReadable: "curl AAAAAAAA...{37 KB truncated}",
  curlFull: `curl ${"A".repeat(50000)}`,
  pythonReadable: "python AAAAAAAA...{37 KB truncated}",
  pythonFull: `python ${"A".repeat(50000)}`,
  nodeReadable: "node AAAAAAAA...{37 KB truncated}",
  nodeFull: `node ${"A".repeat(50000)}`,
};

describe("ViewCodeDialog — plain snippets (no base64)", () => {
  it("renders three tabs and shows the curl content by default", () => {
    render(<ViewCodeDialog open={true} onOpenChange={() => {}} snippets={plainSnips} />);
    expect(screen.getByRole("tab", { name: /curl/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /python/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /node/i })).toBeInTheDocument();
    expect(screen.getByText(plainSnips.curlReadable)).toBeInTheDocument();
  });

  it("clicking Copy writes the active tab's snippet to clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    render(<ViewCodeDialog open={true} onOpenChange={() => {}} snippets={plainSnips} />);
    await user.click(screen.getByRole("button", { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith(plainSnips.curlReadable);
  });

  it("renders the API-key disclaimer", () => {
    render(<ViewCodeDialog open={true} onOpenChange={() => {}} snippets={plainSnips} />);
    expect(screen.getByText(/api key replaced with placeholder|占位符/i)).toBeInTheDocument();
  });

  it("does NOT show the base64 banner when readable === full", () => {
    render(<ViewCodeDialog open={true} onOpenChange={() => {}} snippets={plainSnips} />);
    expect(screen.queryByText(/KB.*base64|base64.*KB/i)).not.toBeInTheDocument();
  });
});

describe("ViewCodeDialog — base64 snippets (readable !== full)", () => {
  it("shows the base64 banner when snippets contain large base64", () => {
    render(<ViewCodeDialog open={true} onOpenChange={() => {}} snippets={base64Snips} />);
    expect(screen.getByText(/KB.*base64|base64.*KB/i)).toBeInTheDocument();
  });

  it("defaults to readable view and shows truncated content", () => {
    render(<ViewCodeDialog open={true} onOpenChange={() => {}} snippets={base64Snips} />);
    // Readable content should be visible
    expect(screen.getByText(/AAAAAAAA.*truncated/i)).toBeInTheDocument();
  });

  it("has two radio options: readable view and full data", () => {
    render(<ViewCodeDialog open={true} onOpenChange={() => {}} snippets={base64Snips} />);
    // Both radios should be present
    expect(screen.getByRole("radio", { name: /readable view/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /full data/i })).toBeInTheDocument();
  });

  it("toggle switches displayed code to full view", async () => {
    const user = userEvent.setup();
    render(<ViewCodeDialog open={true} onOpenChange={() => {}} snippets={base64Snips} />);
    // Click the "Full data" radio
    const fullRadio = screen.getByRole("radio", { name: /full data/i });
    await user.click(fullRadio);
    // Full content should now be visible (checking partial content)
    const pre = document.querySelector("pre");
    expect(pre?.textContent).toContain("AAAAAAAAAAAAAAAA");
  });

  it("Copy readable button copies the readable snippet", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    render(<ViewCodeDialog open={true} onOpenChange={() => {}} snippets={base64Snips} />);
    await user.click(screen.getByRole("button", { name: /copy readable/i }));
    expect(writeText).toHaveBeenCalledWith(base64Snips.curlReadable);
  });

  it("Copy full data button copies the full snippet", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    render(<ViewCodeDialog open={true} onOpenChange={() => {}} snippets={base64Snips} />);
    await user.click(screen.getByRole("button", { name: /copy full/i }));
    expect(writeText).toHaveBeenCalledWith(base64Snips.curlFull);
  });
});
