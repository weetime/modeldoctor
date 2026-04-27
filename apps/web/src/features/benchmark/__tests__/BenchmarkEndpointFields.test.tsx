import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import { BenchmarkEndpointFields } from "../BenchmarkEndpointFields";
import type { CreateBenchmarkRequest } from "../schemas";

function Harness({
  defaultValues,
}: {
  defaultValues?: Partial<CreateBenchmarkRequest>;
}) {
  const form = useForm<CreateBenchmarkRequest>({
    defaultValues: {
      name: "",
      profile: "throughput",
      apiType: "chat",
      apiBaseUrl: "",
      apiKey: "",
      model: "",
      datasetName: "random",
      requestRate: 0,
      totalRequests: 1000,
      ...defaultValues,
    },
  });
  return (
    <FormProvider {...form}>
      <BenchmarkEndpointFields />
    </FormProvider>
  );
}

describe("BenchmarkEndpointFields", () => {
  it("renders four labeled fields", () => {
    render(<Harness />);
    expect(screen.getByLabelText(/api type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/api base url/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/api key/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^model$/i)).toBeInTheDocument();
  });

  it("apiType select offers chat and completion only", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByLabelText(/api type/i));
    expect(screen.getByRole("option", { name: /chat/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /completion/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /embedding/i })).toBeNull();
  });

  it("typing in apiBaseUrl updates the form value", async () => {
    render(<Harness />);
    await userEvent.type(screen.getByLabelText(/api base url/i), "https://api.test");
    expect(screen.getByLabelText(/api base url/i)).toHaveValue("https://api.test");
  });
});
