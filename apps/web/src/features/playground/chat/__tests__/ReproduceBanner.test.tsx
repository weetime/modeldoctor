import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ReproduceBanner } from "../ReproduceBanner";

describe("ReproduceBanner", () => {
  it("renders sample id suffix + expected snippet + back link", () => {
    render(
      <MemoryRouter>
        <ReproduceBanner runId="r1abc" sampleId="s1xyz9876" expected="The capital is Paris" />
      </MemoryRouter>,
    );
    expect(screen.getByText(/样本 #/)).toBeInTheDocument();
    expect(screen.getByText(/Paris/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /返回评测报告/ })).toHaveAttribute(
      "href",
      "/quality-gate/runs/r1abc",
    );
  });
});
