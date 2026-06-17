import { render, screen } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import { ExtraArgsField } from "../_shared/ExtraArgsField";

function Harness({ initial }: { initial?: string } = {}) {
  const form = useForm({ defaultValues: { params: { extraArgs: initial } } });
  return (
    <I18nextProvider i18n={i18n}>
      <FormProvider {...form}>
        <ExtraArgsField fieldPrefix="params" />
      </FormProvider>
    </I18nextProvider>
  );
}

describe("ExtraArgsField", () => {
  it("renders a textarea bound to <prefix>.extraArgs with the form value", () => {
    render(<Harness initial="--extra-inputs foo:bar" />);
    expect(screen.getByRole("textbox")).toHaveValue("--extra-inputs foo:bar");
  });

  it("renders an empty textarea when extraArgs is unset", () => {
    render(<Harness />);
    expect(screen.getByRole("textbox")).toHaveValue("");
  });
});
