import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/lib/i18n";
import { JudgeConfigEditor } from "../JudgeConfigEditor";

beforeAll(async () => {
  await i18n.changeLanguage("zh-CN");
});

function wrap(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

describe("JudgeConfigEditor", () => {
  it("renders exact-match fields by default", () => {
    wrap(<JudgeConfigEditor value={{ kind: "exact-match" }} onChange={() => {}} />);
    // Selector visible (label or text indicating discriminator)
    expect(screen.getByText(/exact-match/i)).toBeInTheDocument();
  });

  it("contains kind shows substrings input", () => {
    wrap(
      <JudgeConfigEditor
        value={{ kind: "contains", substrings: ["x"], mode: "all" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByDisplayValue("x")).toBeInTheDocument();
  });

  it("regex kind shows pattern input", () => {
    wrap(
      <JudgeConfigEditor value={{ kind: "regex", pattern: "^a$" }} onChange={() => {}} />,
    );
    expect(screen.getByDisplayValue("^a$")).toBeInTheDocument();
  });

  it("llm-judge surfaces rubric textarea and scale selector", () => {
    wrap(
      <JudgeConfigEditor
        value={{ kind: "llm-judge", rubric: "rubric ten chars", scale: "0-5" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByDisplayValue("rubric ten chars")).toBeInTheDocument();
  });

  it("changing kind via the selector calls onChange with a blank config of new kind", () => {
    const onChange = vi.fn();
    wrap(<JudgeConfigEditor value={{ kind: "exact-match" }} onChange={onChange} />);
    // Open the Select trigger (combobox role)
    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);
    // Pick the "contains" option
    const containsOption = screen.getByRole("option", { name: /contains/i });
    fireEvent.click(containsOption);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ kind: "contains" }));
  });
});
