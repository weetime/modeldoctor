import "@/lib/i18n";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ViewCodeDialog } from "./ViewCodeDialog";

const snips = {
  curl: "curl -X POST http://x",
  python: "from openai import OpenAI",
  node: "import OpenAI from 'openai';",
};

describe("ViewCodeDialog", () => {
  it("renders three tabs and shows the curl content by default", () => {
    render(<ViewCodeDialog open={true} onOpenChange={() => {}} snippets={snips} />);
    expect(screen.getByRole("tab", { name: /curl/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /python/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /node/i })).toBeInTheDocument();
    expect(screen.getByText(snips.curl)).toBeInTheDocument();
  });

  it("clicking Copy writes the active tab's snippet to clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    // userEvent.setup() installs a getter for navigator.clipboard via
    // Object.defineProperty. We must override it AFTER setup() so our
    // mock isn't overwritten by userEvent's clipboard stub.
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    render(<ViewCodeDialog open={true} onOpenChange={() => {}} snippets={snips} />);
    await user.click(screen.getByRole("button", { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith(snips.curl);
  });

  it("renders the API-key disclaimer", () => {
    render(<ViewCodeDialog open={true} onOpenChange={() => {}} snippets={snips} />);
    expect(screen.getByText(/api key replaced with placeholder|占位符/i)).toBeInTheDocument();
  });
});
