import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UnknownReportView } from "../../reports/UnknownReportView";

describe("UnknownReportView", () => {
  it("renders the reason and pretty-printed JSON", () => {
    render(
      <UnknownReportView raw={{ tool: "future-tool", payload: { x: 1 } }} reason="unknown tool" />,
    );
    expect(screen.getByText(/Report shape not recognized/i)).toBeInTheDocument();
    expect(screen.getByText(/unknown tool/i)).toBeInTheDocument();
    expect(screen.getByText(/"future-tool"/)).toBeInTheDocument();
  });

  it("survives null raw input", () => {
    render(<UnknownReportView raw={null} reason="missing" />);
    expect(screen.getByText(/Report shape not recognized/i)).toBeInTheDocument();
    expect(screen.getByText("null")).toBeInTheDocument();
  });
});
