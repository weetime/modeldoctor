import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { VllmOmniBenchParamsForm } from "../VllmOmniBenchParamsForm";

function Harness({
  defaultLevels = [1, 8, 16],
  onSubmit = vi.fn(),
}: {
  defaultLevels?: number[];
  onSubmit?: (values: unknown) => void;
} = {}) {
  const form = useForm({
    defaultValues: {
      params: {
        concurrencyLevels: defaultLevels,
        inputTokens: 128,
        outputTokens: 128,
        perPointTimeoutSeconds: 60,
        voiceTax: false,
      },
    },
  });
  return (
    <I18nextProvider i18n={i18n}>
      <FormProvider {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <VllmOmniBenchParamsForm />
          <button type="submit">submit</button>
        </form>
      </FormProvider>
    </I18nextProvider>
  );
}

function ExternalUpdateHarness({ children }: { children: (setLevels: () => void) => ReactNode }) {
  const form = useForm({ defaultValues: { params: { concurrencyLevels: [1, 8] } } });
  const setLevels = () => form.setValue("params.concurrencyLevels", [2, 4, 8]);
  return (
    <I18nextProvider i18n={i18n}>
      <FormProvider {...form}>
        <VllmOmniBenchParamsForm />
        {children(setLevels)}
      </FormProvider>
    </I18nextProvider>
  );
}

describe("VllmOmniBenchParamsForm concurrencyLevels", () => {
  it("renders the default levels joined by commas", () => {
    render(<Harness />);
    expect(screen.getByLabelText(/Concurrency levels/i)).toHaveValue("1,8,16");
  });

  it("does not collapse a trailing comma while typing (regression: hand-typed 1,8 used to become 18)", async () => {
    const user = userEvent.setup();
    render(<Harness defaultLevels={[]} />);
    const input = screen.getByLabelText(/Concurrency levels/i);
    await user.type(input, "1,");
    expect(input).toHaveValue("1,");
    await user.type(input, "8");
    expect(input).toHaveValue("1,8");
  });

  it("commits parsed levels to the form on blur and normalizes the displayed text", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness defaultLevels={[]} onSubmit={onSubmit} />);
    const input = screen.getByLabelText(/Concurrency levels/i);
    await user.type(input, "1,8, 16,");
    await user.tab();
    expect(input).toHaveValue("1,8,16");

    await user.click(screen.getByRole("button", { name: /submit/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ concurrencyLevels: [1, 8, 16] }),
      }),
      expect.anything(),
    );
  });

  it("resyncs the input from an external field-value change (e.g. template prefill) when not focused", async () => {
    const user = userEvent.setup();
    render(
      <ExternalUpdateHarness>
        {(setLevels) => (
          <button type="button" onClick={setLevels}>
            prefill
          </button>
        )}
      </ExternalUpdateHarness>,
    );

    const input = screen.getByLabelText(/Concurrency levels/i);
    expect(input).toHaveValue("1,8");

    await user.click(screen.getByRole("button", { name: /prefill/i }));
    expect(input).toHaveValue("2,4,8");
  });
});
