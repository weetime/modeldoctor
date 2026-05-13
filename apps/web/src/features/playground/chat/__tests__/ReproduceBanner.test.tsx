import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import { ReproduceBanner } from "../ReproduceBanner";

describe("ReproduceBanner", () => {
  it("renders sample id suffix + expected snippet + back link", () => {
    render(
      <MemoryRouter>
        <ReproduceBanner runId="r1abc" sampleId="s1xyz9876" expected="The capital is Paris" />
      </MemoryRouter>,
    );
    expect(screen.getByText(/sample #/)).toBeInTheDocument();
    expect(screen.getByText(/Paris/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to report/ })).toHaveAttribute(
      "href",
      "/quality-gate/runs/r1abc",
    );
  });
});
