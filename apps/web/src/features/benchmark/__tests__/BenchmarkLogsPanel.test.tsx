import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import { BenchmarkLogsPanel } from "../BenchmarkLogsPanel";

describe("BenchmarkLogsPanel", () => {
  it("shows pending message when run is non-terminal and logs are null", () => {
    render(<BenchmarkLogsPanel logs={null} state="running" />);
    expect(
      screen.getByText(/logs available after run completes/i),
    ).toBeInTheDocument();
  });

  it("renders logs in a <pre> when present", () => {
    const logs = "line1\nline2\nline3";
    render(<BenchmarkLogsPanel logs={logs} state="completed" />);
    expect(screen.getByText(/line2/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /logs/i })).toBeInTheDocument();
  });

  it("formats size as KB", () => {
    const logs = "x".repeat(3200);
    render(<BenchmarkLogsPanel logs={logs} state="completed" />);
    expect(screen.getByText(/3\.\d KB/)).toBeInTheDocument();
  });
});
