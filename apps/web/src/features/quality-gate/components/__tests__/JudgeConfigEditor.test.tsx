import { fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { I18nextProvider } from "react-i18next";
import { beforeAll, describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import { JudgeConfigEditor } from "../JudgeConfigEditor";

beforeAll(async () => {
  await i18n.changeLanguage("zh-CN");
});

function Harness({ defaultValues, children }: { defaultValues: object; children: ReactNode }) {
  const form = useForm({ defaultValues });
  return (
    <I18nextProvider i18n={i18n}>
      <FormProvider {...form}>{children}</FormProvider>
    </I18nextProvider>
  );
}

describe("JudgeConfigEditor", () => {
  it("renders exact-match fields by default", () => {
    render(
      <Harness defaultValues={{ judgeConfig: { kind: "exact-match" } }}>
        <JudgeConfigEditor namePrefix="judgeConfig" />
      </Harness>,
    );
    // Kind dropdown shows the localized label for exact-match
    expect(screen.getByText("精确匹配")).toBeInTheDocument();
  });

  it("contains kind shows substrings input", () => {
    render(
      <Harness
        defaultValues={{ judgeConfig: { kind: "contains", substrings: ["x"], mode: "all" } }}
      >
        <JudgeConfigEditor namePrefix="judgeConfig" />
      </Harness>,
    );
    expect(screen.getByDisplayValue("x")).toBeInTheDocument();
  });

  it("regex kind shows pattern input", () => {
    render(
      <Harness defaultValues={{ judgeConfig: { kind: "regex", pattern: "^a$" } }}>
        <JudgeConfigEditor namePrefix="judgeConfig" />
      </Harness>,
    );
    expect(screen.getByDisplayValue("^a$")).toBeInTheDocument();
  });

  it("llm-judge surfaces rubric textarea and scale selector", () => {
    render(
      <Harness
        defaultValues={{
          judgeConfig: { kind: "llm-judge", rubric: "rubric ten chars", scale: "0-5" },
        }}
      >
        <JudgeConfigEditor namePrefix="judgeConfig" />
      </Harness>,
    );
    expect(screen.getByDisplayValue("rubric ten chars")).toBeInTheDocument();
  });

  it("changing kind via the selector resets to defaults for the new kind", () => {
    render(
      <Harness defaultValues={{ judgeConfig: { kind: "exact-match" } }}>
        <JudgeConfigEditor namePrefix="judgeConfig" />
      </Harness>,
    );
    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);
    const containsOption = screen.getByRole("option", { name: "关键词包含" });
    fireEvent.click(containsOption);
    // After switching to "contains", the substrings input label should appear
    expect(screen.getByText(/子串列表/)).toBeInTheDocument();
  });
});
