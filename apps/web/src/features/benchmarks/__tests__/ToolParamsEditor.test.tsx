import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { ToolParamsEditor } from "../forms/ToolParamsEditor";

function Wrapper({
  defaultValues,
  children,
}: {
  defaultValues: Record<string, unknown>;
  children: ReactNode;
}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const form = useForm({ defaultValues });
  return (
    <QueryClientProvider client={qc}>
      <FormProvider {...form}>{children}</FormProvider>
    </QueryClientProvider>
  );
}

describe("ToolParamsEditor", () => {
  it("renders a readonly tool badge when scenario has a single tool (capacity)", () => {
    render(
      <Wrapper defaultValues={{ tool: "guidellm", params: {} }}>
        <ToolParamsEditor scenario="capacity" />
      </Wrapper>,
    );
    expect(screen.queryByRole("combobox", { name: /tool/i })).toBeNull();
    expect(screen.getByText(/guidellm/i)).toBeInTheDocument();
  });

  it("renders a tool dropdown when scenario has multiple tools (inference)", () => {
    render(
      <Wrapper defaultValues={{ tool: "guidellm", params: {} }}>
        <ToolParamsEditor scenario="inference" />
      </Wrapper>,
    );
    expect(screen.getByRole("combobox", { name: /tool/i })).toBeInTheDocument();
  });

  it("propagates paramsFieldName='config' to the sub-form's registered field paths", () => {
    render(
      <Wrapper defaultValues={{ tool: "guidellm", config: { profile: "throughput" } }}>
        <ToolParamsEditor scenario="inference" paramsFieldName="config" />
      </Wrapper>,
    );
    // GuidellmParamsForm always renders several <Input> fields via register().
    // With paramsFieldName="config" they should all be prefixed "config.", not "params.".
    const inputs = document.querySelectorAll("input[name]");
    expect(inputs.length).toBeGreaterThan(0);
    for (const el of inputs) {
      const name = (el as HTMLInputElement).name;
      expect(name.startsWith("config.")).toBe(true);
    }
  });
});
