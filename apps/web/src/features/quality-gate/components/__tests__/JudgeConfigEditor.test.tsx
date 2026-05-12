import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { JudgeConfigEditor } from "../JudgeConfigEditor";

describe("JudgeConfigEditor", () => {
  it("renders exact-match fields by default", () => {
    render(<JudgeConfigEditor value={{ kind: "exact-match" }} onChange={() => {}} />);
    // Selector visible (label or text indicating discriminator)
    expect(screen.getByText(/exact-match/i)).toBeInTheDocument();
  });

  it("contains kind shows substrings input", () => {
    render(
      <JudgeConfigEditor
        value={{ kind: "contains", substrings: ["x"], mode: "all" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByDisplayValue("x")).toBeInTheDocument();
  });

  it("regex kind shows pattern input", () => {
    render(
      <JudgeConfigEditor value={{ kind: "regex", pattern: "^a$" }} onChange={() => {}} />,
    );
    expect(screen.getByDisplayValue("^a$")).toBeInTheDocument();
  });

  it("llm-judge surfaces rubric textarea and scale selector", () => {
    render(
      <JudgeConfigEditor
        value={{ kind: "llm-judge", rubric: "rubric ten chars", scale: "0-5" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByDisplayValue("rubric ten chars")).toBeInTheDocument();
  });

  it("changing kind via the selector calls onChange with a blank config of new kind", () => {
    const onChange = vi.fn();
    render(<JudgeConfigEditor value={{ kind: "exact-match" }} onChange={onChange} />);
    // Open the Select trigger (combobox role)
    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);
    // Pick the "contains" option
    const containsOption = screen.getByRole("option", { name: /contains/i });
    fireEvent.click(containsOption);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ kind: "contains" }));
  });
});
