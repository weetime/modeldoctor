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
  scenario: "inference" | "capacity" | "gateway";
  paramsFieldName: "params" | "config";
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
      <Wrapper scenario="capacity" paramsFieldName="params" defaultValues={{ tool: "guidellm", params: {} }}>
        <ToolParamsEditor scenario="capacity" />
      </Wrapper>,
    );
    expect(screen.queryByRole("combobox", { name: /tool/i })).toBeNull();
    expect(screen.getByText(/guidellm/i)).toBeInTheDocument();
  });

  it("renders a tool dropdown when scenario has multiple tools (inference)", () => {
    render(
      <Wrapper scenario="inference" paramsFieldName="params" defaultValues={{ tool: "guidellm", params: {} }}>
        <ToolParamsEditor scenario="inference" />
      </Wrapper>,
    );
    expect(screen.getByRole("combobox", { name: /tool/i })).toBeInTheDocument();
  });

  it("uses paramsFieldName='config' for register paths when prop is supplied", () => {
    render(
      <Wrapper scenario="inference" paramsFieldName="config" defaultValues={{ tool: "guidellm", config: {} }}>
        <ToolParamsEditor scenario="inference" paramsFieldName="config" />
      </Wrapper>,
    );
    expect(screen.getByRole("combobox", { name: /tool/i })).toBeInTheDocument();
  });
});
