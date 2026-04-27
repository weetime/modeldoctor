import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BenchmarkProfilePicker } from "../BenchmarkProfilePicker";
import type { CreateBenchmarkRequest } from "../schemas";

function Harness({
  defaultValues,
}: {
  defaultValues?: Partial<CreateBenchmarkRequest>;
}) {
  const form = useForm<CreateBenchmarkRequest>({
    defaultValues: {
      name: "x",
      profile: "custom",
      apiType: "chat",
      apiUrl: "https://api/v1",
      apiKey: "k",
      model: "m",
      datasetName: "random",
      datasetInputTokens: 1,
      datasetOutputTokens: 1,
      requestRate: 0,
      totalRequests: 1,
      ...defaultValues,
    },
  });
  return (
    <TooltipProvider>
      <FormProvider {...form}>
        <BenchmarkProfilePicker />
        <output data-testid="snapshot">{JSON.stringify(form.watch())}</output>
      </FormProvider>
    </TooltipProvider>
  );
}

describe("BenchmarkProfilePicker", () => {
  it("clicking Throughput chip fills 5 fields", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: /throughput/i }));
    const snap = JSON.parse(screen.getByTestId("snapshot").textContent ?? "{}");
    expect(snap.profile).toBe("throughput");
    expect(snap.datasetInputTokens).toBe(1024);
    expect(snap.datasetOutputTokens).toBe(128);
    expect(snap.requestRate).toBe(0);
    expect(snap.totalRequests).toBe(1000);
    expect(snap.datasetName).toBe("random");
  });

  it("switching to Latency overwrites previous Throughput values", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: /throughput/i }));
    await userEvent.click(screen.getByRole("button", { name: /latency/i }));
    const snap = JSON.parse(screen.getByTestId("snapshot").textContent ?? "{}");
    expect(snap.datasetInputTokens).toBe(128);
    expect(snap.totalRequests).toBe(100);
  });

  it("switching to Custom does NOT clear current values", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: /throughput/i }));
    await userEvent.click(screen.getByRole("button", { name: /^custom$/i }));
    const snap = JSON.parse(screen.getByTestId("snapshot").textContent ?? "{}");
    expect(snap.profile).toBe("custom");
    expect(snap.datasetInputTokens).toBe(1024);
    expect(snap.totalRequests).toBe(1000);
  });

  it("ShareGPT chip is aria-disabled and clicking it does not change profile", async () => {
    render(<Harness />);
    const chip = screen.getByRole("button", { name: /sharegpt/i });
    expect(chip).toBeDisabled();
    const snap = JSON.parse(screen.getByTestId("snapshot").textContent ?? "{}");
    expect(snap.profile).toBe("custom");
  });
});
